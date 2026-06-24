'use strict';

/**
 * Servicio de importación IRAM 1627:1997
 *
 * Lógica compartida entre el script CLI y el endpoint HTTP.
 * Recibe un `db` (Sequelize models) y ejecuta upsert de curvas + sets.
 *
 * ── Diseño determinístico ──
 * • El seed-data se convierte en runtime a un Map<aberturaMm, seedPoint>.
 * • Cada curva se construye con la grilla completa de tamices IRAM que
 *   corresponde a su uso (FINO/TOTAL = 13 tamices, GRUESO = 10 tamices hasta 1.18).
 * • Los tamices sin datos en la curva quedan isNA=true con valores null.
 * • Validación post-construcción aborta la importación si hay inconsistencias.
 */

const path = require('path');
const fs = require('fs');

// ═══════════════════════════════════════════════════════
// Tamices — importados del catálogo centralizado
// ═══════════════════════════════════════════════════════
const {
  IRAM_STANDARD_GRID,
  IRAM_GRUESO_GRID,
  IRAM_ALT_REPLACEMENTS,
  buildAltGrid,
  getGrid,
} = require('../catalog/tamicesCatalog');

// ═══════════════════════════════════════════════════════
// Tamiz DB lookup — designación → idTamiz
// ═══════════════════════════════════════════════════════

/**
 * Reúne todas las designaciones de tamices que el seed IRAM 1627 va a usar
 * (uniendo las tres grillas que el importer arma).
 */
function gatherRequiredDesignaciones() {
  const finoGrid = getGrid('FINO', 'ESTANDAR');
  const finoAltGrid = getGrid('FINO', 'ALTERNATIVO');
  const gruesoGrid = getGrid('GRUESO', 'ESTANDAR');
  const gruesoAltGrid = getGrid('GRUESO', 'ALTERNATIVO');
  const totalGrid = getGrid('TOTAL', 'ESTANDAR');
  const totalAltGrid = getGrid('TOTAL', 'ALTERNATIVO');
  const all = [
    ...finoGrid, ...finoAltGrid,
    ...gruesoGrid, ...gruesoAltGrid,
    ...totalGrid, ...totalAltGrid,
  ];
  const byDesignacion = new Map();
  for (const t of all) {
    if (!byDesignacion.has(t.tamiz)) {
      byDesignacion.set(t.tamiz, t.aberturaMm);
    }
  }
  return byDesignacion;
}

/**
 * Asegura que cada designación requerida exista en `Tamiz`. Si falta, la crea
 * vía findOrCreate (idempotente). El orden inicial se calcula por aberturaMm
 * descendente para mantener consistencia con la convención del seed-tamices.js.
 *
 * Devuelve un Map<designacion, idTamiz>.
 */
async function ensureTamicesExist(db, t, onLog) {
  const required = gatherRequiredDesignaciones();
  const designaciones = [...required.keys()];

  // 1) Buscar los existentes en una sola query.
  const existing = await db.Tamiz.findAll({
    where: { designacion: designaciones },
    attributes: ['idTamiz', 'designacion'],
    transaction: t,
    raw: true,
  });
  const map = new Map();
  for (const row of existing) map.set(row.designacion, row.idTamiz);

  // 2) Crear los que falten.
  const faltantes = designaciones.filter((d) => !map.has(d));
  if (faltantes.length === 0) return map;

  onLog && onLog('info', `Auto-seed Tamiz: creando ${faltantes.length} designacion(es) faltante(s)`);

  // Orden estable: por aberturaMm descendente, base 1000 + idx*10.
  const sorted = [...required.entries()]
    .filter(([d]) => faltantes.includes(d))
    .sort((a, b) => b[1] - a[1]);

  for (let i = 0; i < sorted.length; i++) {
    const [designacion, aberturaMm] = sorted[i];
    const [row] = await db.Tamiz.findOrCreate({
      where: { designacion },
      defaults: {
        designacion,
        aberturaMm,
        notacion: 'METRICA',
        orden: 1000 + i * 10,
        aptoHormigon: true,
        aptoTBS: false,
        activo: true,
      },
      transaction: t,
    });
    map.set(designacion, row.idTamiz);
  }
  return map;
}

// ─── Load seed data (BOM-safe) ─────────────────────────
function loadSeedData() {
  const filePath = path.join(__dirname, '..', '..', 'seed-data', 'iram', 'iram1627_1997_curvas.json');
  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

// ─── Build aperture map from seed array ────────────────
/**
 * Converts an array of seed points into a Map keyed by aberturaMm.
 * Uses a tolerance-free string key (rounded to 2 decimals) for deterministic lookup.
 * @param {Array} puntosArr - [{aberturaMm, ...}, ...]
 * @returns {Map<string, Object>} keyed by aberturaMm rounded string
 */
function buildApertureMap(puntosArr) {
  const map = new Map();
  for (const pt of puntosArr) {
    const key = roundKey(pt.aberturaMm);
    if (map.has(key)) {
      throw new Error(`Seed-data duplicado para abertura ${pt.aberturaMm} mm`);
    }
    map.set(key, pt);
  }
  return map;
}

/** Deterministic string key from aperture value */
function roundKey(aberturaMm) {
  return Number(aberturaMm).toFixed(2);
}

// ─── Upsert Curva + Puntos ─────────────────────────────
async function upsertCurva(db, curvaData, puntosData, t) {
  const existing = await db.CurvaGranulometrica.findOne({
    where: { nombre: curvaData.nombre },
    transaction: t,
  });

  if (existing) {
    await existing.update({
      tipo: curvaData.tipo,
      specMode: curvaData.specMode,
      serieTamices: curvaData.serieTamices,
      uso: curvaData.uso,
      aplicaA: curvaData.aplicaA ?? existing.aplicaA,
      tmnMm: curvaData.tmnMm,
      tmnMinMm: curvaData.tmnMinMm ?? existing.tmnMinMm,
      tmnMaxMm: curvaData.tmnMaxMm ?? existing.tmnMaxMm,
      curveLetter: curvaData.curveLetter,
      origenDatos: curvaData.origenDatos,
      estadoDatos: curvaData.estadoDatos,
      normaRef: curvaData.normaRef,
      metadata: curvaData.metadata,
      isActive: true,
      idCurvaSet: curvaData.idCurvaSet || existing.idCurvaSet,
    }, { transaction: t });

    await db.CurvaPunto.destroy({ where: { idCurva: existing.idCurva }, transaction: t });
    const puntos = puntosData.map((p, i) => ({
      ...p,
      idCurva: existing.idCurva,
      orden: p.orden ?? i,
    }));
    await db.CurvaPunto.bulkCreate(puntos, { transaction: t });

    return { action: 'updated', curva: existing };
  }

  const curva = await db.CurvaGranulometrica.create(curvaData, { transaction: t });
  const puntos = puntosData.map((p, i) => ({
    ...p,
    idCurva: curva.idCurva,
    orden: p.orden ?? i,
  }));
  await db.CurvaPunto.bulkCreate(puntos, { transaction: t });

  return { action: 'created', curva };
}

// ─── Upsert CurvaSet ──────────────────────────────────
async function upsertCurvaSet(db, setData, t) {
  const existing = await db.CurvaSet.findOne({
    where: { nombre: setData.nombre },
    transaction: t,
  });

  if (existing) {
    await existing.update({
      serieTamices: setData.serieTamices,
      materialUso: setData.materialUso,
      tmnMm: setData.tmnMm,
      normaRef: setData.normaRef,
      descripcion: setData.descripcion,
      estado: setData.estado,
      isActive: true,
    }, { transaction: t });
    return { action: 'updated', set: existing };
  }

  const set = await db.CurvaSet.create(setData, { transaction: t });
  return { action: 'created', set };
}

// ═══════════════════════════════════════════════════════
// Full-grid point builders (deterministic by aperture)
// ═══════════════════════════════════════════════════════

/**
 * Generic builder: iterates the provided grid, maps each sieve to seed data
 * by aperture key, and applies the valueFn for populating spec fields.
 * Sieves not found in seedMap → isNA=true + all nulls.
 *
 * @param {Array} grid      - Sieve grid to iterate
 * @param {Map}   seedMap   - Aperture map from seed data
 * @param {Function} valueFn - (seedPt) => partial object with spec fields
 * @param {Map}   tamizMap  - designacion → idTamiz (FK requerida por CurvaPunto)
 * @returns {Array} CurvaPunto payloads
 */
function buildPuntosGeneric(grid, seedMap, valueFn, tamizMap) {
  return grid.map((tam, i) => {
    const key = roundKey(tam.aberturaMm);
    const seedPt = seedMap.get(key);
    const idTamiz = tamizMap && tamizMap.get(tam.tamiz);
    if (tamizMap && !idTamiz) {
      // Defensive: el ensureTamicesExist debería haberlo creado. Si no, fallar
      // explícitamente acá con un mensaje útil antes de que MySQL devuelva
      // un FK constraint críptico.
      throw new Error(
        `Tamiz "${tam.tamiz}" no encontrado en la BD. ` +
        `Ejecutá scripts/seed-tamices.js o verificá que la designación coincida.`
      );
    }

    const base = {
      idTamiz,
      tamiz: tam.tamiz,
      aberturaMm: tam.aberturaMm,
      pasaPct: null, limInfPct: null, limSupPct: null, targetPct: null,
    };

    if (!seedPt) {
      return { ...base, isNA: true, orden: i };
    }

    // Seed explicitly marks N/A (e.g. grueso ranges with "na": true)
    if (seedPt.na === true) {
      return { ...base, isNA: true, orden: i };
    }

    return {
      ...base,
      isNA: false,
      orden: i,
      ...valueFn(seedPt),
    };
  });
}

/**
 * Builds the full grid for a FINO curve.
 */
function buildPuntosFino(grid, seedMap, specMode, tamizMap) {
  return buildPuntosGeneric(grid, seedMap, (seedPt) => {
    if (specMode === 'MAX_ONLY') return { limSupPct: seedPt.max };
    if (specMode === 'RANGO')    return { limInfPct: seedPt.min, limSupPct: seedPt.max };
    if (specMode === 'MIN_ONLY') return { limInfPct: seedPt.min };
    return {};
  }, tamizMap);
}

/**
 * Builds the full grid for a GRUESO curve.
 */
function buildPuntosGrueso(grid, seedMap, tamizMap) {
  return buildPuntosGeneric(grid, seedMap, (seedPt) => ({
    limInfPct: seedPt.min,
    limSupPct: seedPt.max,
  }), tamizMap);
}

/**
 * Builds the full grid for a TOTAL curve (specMode=OBJETIVO).
 */
function buildPuntosTotal(grid, seedMap, tamizMap) {
  return buildPuntosGeneric(grid, seedMap, (seedPt) => ({
    targetPct: seedPt.target,
  }), tamizMap);
}

// ═══════════════════════════════════════════════════════
// Post-construction validation
// ═══════════════════════════════════════════════════════

/**
 * Validates that built puntos match the seed data exactly.
 * - Total count must match the grid length.
 * - For each seed entry, the corresponding punto must have the correct value.
 * - Aperturas not in the seed must be isNA=true.
 * @param {string} curvaNombre - For error reporting
 * @param {Array} puntos - Built punto objects
 * @param {Map} seedMap - Aperture map from seed data
 * @param {string} specMode - OBJETIVO, RANGO, MAX_ONLY
 * @param {Array} grid - The sieve grid used for this curve
 * @throws {Error} with detailed diff on mismatch
 */
function validatePuntos(curvaNombre, puntos, seedMap, specMode, grid) {
  const diffs = [];

  // 1. Must have exactly as many points as the grid
  if (puntos.length !== grid.length) {
    diffs.push(`Cantidad de puntos: esperado ${grid.length}, obtuvo ${puntos.length}`);
  }

  // 2. For each punto, validate against seed data
  for (const pt of puntos) {
    const key = roundKey(pt.aberturaMm);
    const seedPt = seedMap.get(key);

    if (!seedPt) {
      // This apertura should be N/A
      if (!pt.isNA) {
        diffs.push(`Tamiz ${pt.tamiz} (${pt.aberturaMm}mm): esperado isNA=true, obtuvo isNA=${pt.isNA}`);
      }
      if (pt.targetPct !== null || pt.limInfPct !== null || pt.limSupPct !== null || pt.pasaPct !== null) {
        diffs.push(`Tamiz ${pt.tamiz} (${pt.aberturaMm}mm): esperado valores null (N/A), obtuvo target=${pt.targetPct} limInf=${pt.limInfPct} limSup=${pt.limSupPct}`);
      }
    } else {
      // Should NOT be N/A (unless seed explicitly says na=true)
      const expectedNA = seedPt.na === true;
      if (pt.isNA !== expectedNA) {
        diffs.push(`Tamiz ${pt.tamiz} (${pt.aberturaMm}mm): esperado isNA=${expectedNA}, obtuvo isNA=${pt.isNA}`);
      }

      if (!expectedNA) {
        // Validate values based on specMode
        if (specMode === 'OBJETIVO') {
          if (pt.targetPct !== seedPt.target) {
            diffs.push(`Tamiz ${pt.tamiz} (${pt.aberturaMm}mm): targetPct esperado=${seedPt.target}, obtuvo=${pt.targetPct}`);
          }
        } else if (specMode === 'MAX_ONLY') {
          if (pt.limSupPct !== seedPt.max) {
            diffs.push(`Tamiz ${pt.tamiz} (${pt.aberturaMm}mm): limSupPct esperado=${seedPt.max}, obtuvo=${pt.limSupPct}`);
          }
        } else if (specMode === 'RANGO') {
          if (pt.limInfPct !== seedPt.min) {
            diffs.push(`Tamiz ${pt.tamiz} (${pt.aberturaMm}mm): limInfPct esperado=${seedPt.min}, obtuvo=${pt.limInfPct}`);
          }
          if (pt.limSupPct !== seedPt.max) {
            diffs.push(`Tamiz ${pt.tamiz} (${pt.aberturaMm}mm): limSupPct esperado=${seedPt.max}, obtuvo=${pt.limSupPct}`);
          }
        }
      }
    }
  }

  // 3. Verify all seed entries were mapped (no orphans)
  for (const [key, seedPt] of seedMap.entries()) {
    const matching = puntos.find(p => roundKey(p.aberturaMm) === key);
    if (!matching) {
      diffs.push(`Seed abertura ${seedPt.aberturaMm}mm no tiene punto correspondiente en la grilla`);
    }
  }

  if (diffs.length > 0) {
    throw new Error(
      `Validación fallida para curva "${curvaNombre}" — ${diffs.length} diferencia(s):\n` +
      diffs.map(d => `  • ${d}`).join('\n')
    );
  }
}

// ═══════════════════════════════════════════════════════
// Post-import DB verification (round-trip)
// ═══════════════════════════════════════════════════════

/**
 * Reads all IRAM 1627 curves back from DB (within transaction) and
 * compares each punto against the seed-data source of truth.
 * Throws with a detailed diff listing on ANY mismatch.
 * Called before commit so a failure triggers rollback.
 */
async function verifyImportedCurves(db, seed, t, onLog) {
  const diffs = [];

  // Helper: compare a single DB curve against expected seed points
  async function verifyCurve(nombre, expectedSeedPts, specMode, grid) {
    const curva = await db.CurvaGranulometrica.findOne({
      where: { nombre },
      transaction: t,
    });
    if (!curva) {
      diffs.push(`Curva "${nombre}": no encontrada en DB`);
      return;
    }
    const dbPuntos = await db.CurvaPunto.findAll({
      where: { idCurva: curva.idCurva },
      order: [['orden', 'ASC']],
      transaction: t,
    });

    if (dbPuntos.length !== grid.length) {
      diffs.push(`"${nombre}": esperado ${grid.length} puntos, encontró ${dbPuntos.length}`);
      return;
    }

    const seedMap = buildApertureMap(expectedSeedPts);

    for (const dbPt of dbPuntos) {
      const key = roundKey(dbPt.aberturaMm);
      const seedPt = seedMap.get(key);

      if (!seedPt) {
        // Should be N/A in DB
        if (!dbPt.isNA) {
          diffs.push(`"${nombre}" tamiz ${dbPt.aberturaMm}mm: DB isNA=false, esperado isNA=true`);
        }
        if (dbPt.targetPct !== null || dbPt.limInfPct !== null || dbPt.limSupPct !== null) {
          diffs.push(`"${nombre}" tamiz ${dbPt.aberturaMm}mm: DB tiene valores no-null para N/A (target=${dbPt.targetPct}, limInf=${dbPt.limInfPct}, limSup=${dbPt.limSupPct})`);
        }
      } else {
        if (dbPt.isNA) {
          diffs.push(`"${nombre}" tamiz ${dbPt.aberturaMm}mm: DB isNA=true, esperado isNA=false`);
        }
        if (specMode === 'OBJETIVO') {
          if (dbPt.targetPct !== seedPt.target) {
            diffs.push(`"${nombre}" tamiz ${dbPt.aberturaMm}mm: targetPct DB=${dbPt.targetPct}, esperado=${seedPt.target}`);
          }
        } else if (specMode === 'MAX_ONLY') {
          if (dbPt.limSupPct !== seedPt.max) {
            diffs.push(`"${nombre}" tamiz ${dbPt.aberturaMm}mm: limSupPct DB=${dbPt.limSupPct}, esperado=${seedPt.max}`);
          }
        } else if (specMode === 'RANGO') {
          if (dbPt.limInfPct !== seedPt.min) {
            diffs.push(`"${nombre}" tamiz ${dbPt.aberturaMm}mm: limInfPct DB=${dbPt.limInfPct}, esperado=${seedPt.min}`);
          }
          if (dbPt.limSupPct !== seedPt.max) {
            diffs.push(`"${nombre}" tamiz ${dbPt.aberturaMm}mm: limSupPct DB=${dbPt.limSupPct}, esperado=${seedPt.max}`);
          }
        }
      }
    }
  }

  // Verify FINOS
  const finoGrid = getGrid('FINO', seed.finos.serieTamices);
  for (const [letter, curvaData] of Object.entries(seed.finos.curvas)) {
    const nombre = `IRAM 1627:1997 — Fino — Curva ${letter}`;
    await verifyCurve(nombre, curvaData.puntos, curvaData.specMode, finoGrid);
  }

  // Verify GRUESOS
  const gruesoGrid = getGrid('GRUESO', seed.gruesos.serieTamices);
  for (const rangoData of seed.gruesos.rangos) {
    const nombre = `IRAM 1627:1997 — Grueso — ${rangoData.rango}`;
    await verifyCurve(nombre, rangoData.puntos, 'RANGO', gruesoGrid);
  }

  // Verify TOTALES
  const totalGrid = getGrid('TOTAL', seed.totales.serieTamices);
  for (const [tmnStr, tablaData] of Object.entries(seed.totales.tablas)) {
    const tmn = Number(tmnStr);
    for (const [letter, puntosArr] of Object.entries(tablaData.curvas)) {
      const nombre = `IRAM 1627:1997 — Total — TMN ${tmn} — Curva ${letter}`;
      await verifyCurve(nombre, puntosArr, 'OBJETIVO', totalGrid);
    }
  }

  if (diffs.length > 0) {
    const msg = `VERIFICACIÓN POST-IMPORT FALLIDA — ${diffs.length} diferencia(s):\n` +
      diffs.map(d => `  • ${d}`).join('\n');
    throw new Error(msg);
  }

  onLog('ok', `Verificación OK — todas las curvas coinciden con la norma`);
}

// ═══════════════════════════════════════════════════════
// Main import function
// ═══════════════════════════════════════════════════════
/**
 * Imports all IRAM 1627:1997 curves into the database.
 * @param {Object} db - Sequelize models (multi-tenant db object)
 * @param {Object} [options]
 * @param {Function} [options.onLog] - Callback for log messages: (level, msg) => {}
 * @param {boolean} [options.reset] - If true, delete all IRAM 1627 data before importing
 * @returns {Promise<Object>} stats with created/updated/errors counts
 */
async function importIRAM1627(db, options = {}) {
  const onLog = options.onLog || (() => {});
  const seed = loadSeedData();

  const stats = {
    curvasCreated: 0,
    curvasUpdated: 0,
    setsCreated: 0,
    setsUpdated: 0,
    pointsCreated: 0,
    errors: [],
  };

  const t = await db.sequelize.transaction();

  try {
    // ── 0.a Asegurar catálogo Tamiz ──
    // El insert de CurvaPunto requiere idTamiz (FK NOT NULL). Si el tenant no
    // tiene Tamiz seeded, lo armamos automáticamente con findOrCreate por
    // `designacion`. Tenants que ya lo tienen no se ven afectados.
    onLog('step', 'Asegurando catálogo Tamiz');
    const tamizMap = await ensureTamicesExist(db, t, onLog);
    onLog('info', `Tamiz designaciones disponibles: ${tamizMap.size}`);

    // ── 0.b Optional reset ──
    if (options.reset) {
      onLog('step', 'RESET — Borrando datos IRAM 1627 existentes');
      const existingCurvas = await db.CurvaGranulometrica.findAll({
        where: { normaRef: seed.normaRef },
        attributes: ['idCurva'],
        transaction: t,
      });
      const curvaIds = existingCurvas.map(c => c.idCurva);
      if (curvaIds.length > 0) {
        const deletedPuntos = await db.CurvaPunto.destroy({
          where: { idCurva: curvaIds },
          transaction: t,
        });
        onLog('info', `Puntos eliminados: ${deletedPuntos}`);
      }
      const deletedCurvas = await db.CurvaGranulometrica.destroy({
        where: { normaRef: seed.normaRef },
        transaction: t,
      });
      onLog('info', `Curvas eliminadas: ${deletedCurvas}`);
      const deletedSets = await db.CurvaSet.destroy({
        where: { normaRef: seed.normaRef },
        transaction: t,
      });
      onLog('info', `Sets eliminados: ${deletedSets}`);
    }

    // ── 1. FINOS (Tabla 1) ──
    onLog('step', 'FINOS — Tabla 1');
    const finoSection = seed.finos;
    const finoGrid = getGrid('FINO', finoSection.serieTamices);

    for (const [letter, curvaData] of Object.entries(finoSection.curvas)) {
      const specMode = curvaData.specMode;
      const nombre = `IRAM 1627:1997 — Fino — Curva ${letter}`;

      // Build aperture map from seed points
      const seedMap = buildApertureMap(curvaData.puntos);

      const curvaPayload = {
        nombre,
        tipo: curvaData.tipo,
        specMode,
        serieTamices: finoSection.serieTamices,
        uso: 'FINO',
        aplicaA: ['FINO'],
        tmnMm: null,
        tmnMinMm: null,
        tmnMaxMm: null,
        curveLetter: letter,
        origenDatos: 'IRAM',
        estadoDatos: 'COMPLETO',
        normaRef: seed.normaRef,
        metadata: {
          edicion: '1997',
          referenciaTabla: finoSection.referenciaTabla,
          descripcion: curvaData.descripcion,
        },
        isDefault: false,
        isActive: true,
        version: '1.0',
      };

      const puntosPayload = buildPuntosFino(finoGrid, seedMap, specMode, tamizMap);

      // Validate before persisting
      validatePuntos(nombre, puntosPayload, seedMap, specMode, finoGrid);

      const result = await upsertCurva(db, curvaPayload, puntosPayload, t);
      stats[result.action === 'created' ? 'curvasCreated' : 'curvasUpdated']++;
      stats.pointsCreated += puntosPayload.length;
      onLog('ok', `Fino ${letter} (${specMode}): ${result.action} — ${puntosPayload.length} puntos`);
    }

    // ── 2. GRUESOS (Tabla 2) ──
    onLog('step', 'GRUESOS — Tabla 2');
    const gruesoSection = seed.gruesos;
    const gruesoGrid = getGrid('GRUESO', gruesoSection.serieTamices);

    // Cleanup: delete old ranges that no longer exist in the standard
    const oldRangesToDelete = [
      'IRAM 1627:1997 — Grueso — 63 a 4.75',
      'IRAM 1627:1997 — Grueso — 9.5 a 4.75',
      'IRAM 1627:1997 — Grueso — 50 a 4.75',
    ];
    for (const oldName of oldRangesToDelete) {
      const old = await db.CurvaGranulometrica.findOne({ where: { nombre: oldName }, transaction: t });
      if (old) {
        await db.CurvaPunto.destroy({ where: { idCurva: old.idCurva }, transaction: t });
        await old.destroy({ transaction: t });
        onLog('info', `Eliminado rango obsoleto: ${oldName}`);
      }
    }

    for (const rangoData of gruesoSection.rangos) {
      const nombre = `IRAM 1627:1997 — Grueso — ${rangoData.rango}`;

      // Build aperture map from seed points
      const seedMap = buildApertureMap(rangoData.puntos);

      // Parse TMN range from rango string (e.g. "37.5 a 4.75")
      const rangoMatch = rangoData.rango.match(/([\d.]+)\s*a\s*([\d.]+)/);
      const rangoTmnMax = rangoMatch ? Math.max(parseFloat(rangoMatch[1]), parseFloat(rangoMatch[2])) : null;
      const rangoTmnMin = rangoMatch ? Math.min(parseFloat(rangoMatch[1]), parseFloat(rangoMatch[2])) : null;

      const curvaPayload = {
        nombre,
        tipo: 'BANDA',
        specMode: 'RANGO',
        serieTamices: gruesoSection.serieTamices,
        uso: 'GRUESO',
        aplicaA: ['GRUESO'],
        tmnMm: rangoTmnMax,
        tmnMinMm: rangoTmnMin,
        tmnMaxMm: rangoTmnMax,
        curveLetter: null,
        origenDatos: 'IRAM',
        estadoDatos: 'COMPLETO',
        normaRef: seed.normaRef,
        metadata: {
          edicion: '1997',
          referenciaTabla: gruesoSection.referenciaTabla,
          rangoGrueso: rangoData.rango,
        },
        isDefault: false,
        isActive: true,
        version: '1.0',
      };

      const puntosPayload = buildPuntosGrueso(gruesoGrid, seedMap, tamizMap);

      // Validate before persisting
      validatePuntos(nombre, puntosPayload, seedMap, 'RANGO', gruesoGrid);

      const result = await upsertCurva(db, curvaPayload, puntosPayload, t);
      stats[result.action === 'created' ? 'curvasCreated' : 'curvasUpdated']++;
      stats.pointsCreated += puntosPayload.length;
      onLog('ok', `Grueso [${rangoData.rango}]: ${result.action} — ${puntosPayload.length} puntos`);
    }

    // ── 3. TOTALES (Tablas 3–8) ──
    onLog('step', 'TOTALES — Tablas 3 a 8');
    const totalSection = seed.totales;
    const totalGrid = getGrid('TOTAL', totalSection.serieTamices);

    for (const [tmnStr, tablaData] of Object.entries(totalSection.tablas)) {
      const tmn = Number(tmnStr);
      const tablaRef = tablaData.referenciaTabla;

      const setNombre = `IRAM 1627:1997 — Total — TMN ${tmn}`;
      const setPayload = {
        nombre: setNombre,
        serieTamices: totalSection.serieTamices,
        materialUso: 'TOTAL',
        tmnMm: tmn,
        normaRef: seed.normaRef,
        descripcion: `Set de curvas IRAM 1627 para agregados totales, TMN ${tmn} mm. ${tablaRef}`,
        estado: 'COMPLETO',
        isDefault: false,
        isActive: true,
      };

      const setResult = await upsertCurvaSet(db, setPayload, t);
      stats[setResult.action === 'created' ? 'setsCreated' : 'setsUpdated']++;
      const idCurvaSet = setResult.set.idCurvaSet;
      onLog('info', `Set TMN ${tmn} (${tablaRef}): ${setResult.action}`);

      for (const [letter, puntosArr] of Object.entries(tablaData.curvas)) {
        const nombre = `IRAM 1627:1997 — Total — TMN ${tmn} — Curva ${letter}`;

        // Build aperture map from seed points
        const seedMap = buildApertureMap(puntosArr);

        const curvaPayload = {
          nombre,
          tipo: 'BANDA',
          specMode: 'OBJETIVO',
          serieTamices: totalSection.serieTamices,
          uso: 'TOTAL',
          aplicaA: ['TOTAL'],
          tmnMm: tmn,
          tmnMinMm: tmn,
          tmnMaxMm: tmn,
          curveLetter: letter,
          origenDatos: 'IRAM',
          estadoDatos: 'COMPLETO',
          normaRef: seed.normaRef,
          metadata: { edicion: '1997', referenciaTabla: tablaRef },
          isDefault: false,
          isActive: true,
          version: '1.0',
          idCurvaSet,
        };

        const puntosPayload = buildPuntosTotal(totalGrid, seedMap, tamizMap);

        // Validate before persisting
        validatePuntos(nombre, puntosPayload, seedMap, 'OBJETIVO', totalGrid);

        const result = await upsertCurva(db, curvaPayload, puntosPayload, t);
        stats[result.action === 'created' ? 'curvasCreated' : 'curvasUpdated']++;
        stats.pointsCreated += puntosPayload.length;
        onLog('ok', `  Curva ${letter}: ${result.action} — ${puntosPayload.length} puntos`);
      }
    }

    // ── 4. VERIFICACIÓN POST-IMPORT (round-trip) ──
    onLog('step', 'Verificación post-import — lectura desde DB');
    await verifyImportedCurves(db, seed, t, onLog);

    await t.commit();
    onLog('step', 'Importación completada — verificación OK');
    return stats;

  } catch (err) {
    await t.rollback();
    stats.errors.push(err.message);
    onLog('error', `Error fatal: ${err.message}`);
    throw err;
  }
}

module.exports = {
  importIRAM1627,
  loadSeedData,
  // Re-exported from tamicesCatalog for backward compat
  IRAM_STANDARD_GRID,
  IRAM_GRUESO_GRID,
  IRAM_ALT_REPLACEMENTS,
  buildAltGrid,
  getGrid,
  // Funciones propias del importador
  buildApertureMap,
  buildPuntosGeneric,
  buildPuntosFino,
  buildPuntosGrueso,
  buildPuntosTotal,
  validatePuntos,
  verifyImportedCurves,
};
