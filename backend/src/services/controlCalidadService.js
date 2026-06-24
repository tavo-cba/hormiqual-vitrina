/**
 * controlCalidadService.js
 *
 * Backend service for the Quality Control Dashboard (FUNC-08),
 * Shewhart control charts, Western Electric rules, and monthly report data.
 */
/* eslint-disable camelcase */
const { Op, fn, col, literal } = require('sequelize');
const dayjs = require('dayjs');

// CTL-29 / A4 (sesión 2026-05-10) — stats Shewhart y reglas Western
// Electric viven en `domain/spc/` como engines puros.
const { computeMeanSd, computeShewhartStats } = require('../domain/spc/shewhartEngine');
const { evaluateWesternElectric } = require('../domain/spc/westernElectricEngine');
require('dayjs/locale/es');

const safe = (v, fallback = 0) => (v != null ? Number(v) : fallback);
const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : 0);
const round2 = (n) => Math.round((n || 0) * 100) / 100;
const round3 = (n) => Math.round((n || 0) * 1000) / 1000;

/* ═══════════════════════════════════════
   Helper: build common WHERE
   ═══════════════════════════════════════ */
function buildWhere(params, user) {
  const { idPlanta, idTipoHormigon, desde, hasta } = params;
  const where = { activo: true };

  if (idPlanta) where.idPlanta = +idPlanta;
  if (!user.allPlantas) {
    const allowed = Array.isArray(user.plantaIds) ? user.plantaIds.map(id => +id) : [];
    if (allowed.length) {
      if (where.idPlanta) {
        if (!allowed.includes(where.idPlanta)) where.idPlanta = 0;
      } else {
        where.idPlanta = { [Op.in]: allowed };
      }
    } else {
      where.idPlanta = 0;
    }
  }

  if (desde || hasta) {
    where.fecha = {};
    if (desde) where.fecha[Op.gte] = desde;
    if (hasta) where.fecha[Op.lte] = hasta;
  }

  return { where, idTipoHormigon: idTipoHormigon ? +idTipoHormigon : null };
}

/**
 * Build a Despacho include chain that optionally filters by idTipoHormigon.
 * When idTipoHormigon is set, required:true is propagated through the chain
 * to force INNER JOINs (otherwise Sequelize uses LEFT JOIN and the WHERE is ignored).
 */
function buildDespachoInclude(db, where, idTipoHormigon, opts = {}) {
  const { despachoAttrs = [], dosAttrs = [] } = opts;
  const filtering = !!idTipoHormigon;

  const dosInclude = {
    model: db.Dosificacion, as: 'dosificacion', attributes: dosAttrs,
    include: [{ model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] }],
  };
  if (filtering) {
    dosInclude.where = { idTipoHormigon };
    dosInclude.required = true;
  }

  return {
    model: db.Despacho, as: 'despacho', attributes: despachoAttrs, where,
    required: filtering,
    include: [dosInclude],
  };
}

/** Parse target resistance from "H-25" → 25 */
function parseTarget(tipoHormigon) {
  if (!tipoHormigon) return null;
  const m = tipoHormigon.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/* ═══════════════════════════════════════
   1. Dashboard KPIs
   ═══════════════════════════════════════ */
async function getDashboardKpis(db, params, user) {
  const { where, idTipoHormigon } = buildWhere(params, user);

  // Get muestras linked to dispatches in range (filtered by tipo if set)
  const muestras = await db.Muestra.findAll({
    attributes: ['idMuestra'],
    include: [buildDespachoInclude(db, where, idTipoHormigon)],
    raw: true,
  });
  const mIds = muestras.map(m => m.idMuestra);

  const result = {
    totalMuestras: mIds.length,
    totalProbetas: 0,
    totalEnsayos: 0,
    pendientesRevision: 0,
    cumplimiento28d: null,
    tasaMuestreo: 0,
    // Cross-type meaningful indicators
    peorTipo: null,        // { tipo, cumplimiento, n }
    tipoMayorCV: null,     // { tipo, cv, n }
    tiposBajoControl: 0,   // count of types with compliance >= 90%
    totalTipos: 0,
  };

  if (!mIds.length) return result;

  // Count dispatches (filtered by tipo if set)
  const despCountInc = [];
  if (idTipoHormigon) {
    despCountInc.push({
      model: db.Dosificacion, as: 'dosificacion', attributes: [],
      where: { idTipoHormigon },
    });
  }
  const despAgg = await db.Despacho.findOne({
    where,
    include: despCountInc,
    attributes: [
      [fn('COUNT', col('idDespacho')), 'total'],
      [fn('SUM', literal('CASE WHEN tieneMuestra = 1 THEN 1 ELSE 0 END')), 'conMuestra'],
    ],
    raw: true,
  });
  result.tasaMuestreo = pct(safe(despAgg?.conMuestra), safe(despAgg?.total));

  const probetaWhere = { idMuestra: { [Op.in]: mIds } };

  // Probetas count
  const probAgg = await db.Probeta.findOne({
    where: probetaWhere,
    attributes: [[fn('COUNT', col('idProbeta')), 'total']],
    raw: true,
  });
  result.totalProbetas = safe(probAgg?.total);

  // Ensayos count
  const ensAgg = await db.EnsayoResistencia.findOne({
    include: [{ model: db.Probeta, as: 'probeta', attributes: [], where: probetaWhere }],
    attributes: [[fn('COUNT', col('idEnsayoResistencia')), 'total']],
    raw: true,
  });
  result.totalEnsayos = safe(ensAgg?.total);

  // Pending review
  const pendAgg = await db.EnsayoResistencia.findOne({
    where: { pendienteRevision: 1 },
    include: [{ model: db.Probeta, as: 'probeta', attributes: [], where: probetaWhere }],
    attributes: [[fn('COUNT', col('idEnsayoResistencia')), 'total']],
    raw: true,
  });
  result.pendientesRevision = safe(pendAgg?.total);

  // 28d resistance — group by tipo to compute per-type stats
  const ensayoInclude = [{
    model: db.Probeta, as: 'probeta', attributes: [],
    where: probetaWhere,
    include: [{
      model: db.Muestra, as: 'muestra', attributes: [],
      include: [{
        model: db.Despacho, as: 'despacho', attributes: [],
        include: [{
          model: db.Dosificacion, as: 'dosificacion', attributes: [],
          include: [{ model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] }],
        }],
      }],
    }],
  }];

  // Sprint 1 — bug C1 (sesión 2026-05-10): excluir ensayos pendientes
  // de revisión. CIRSOC 200-2024 §6.2 e IRAM 1666:2020 §A.7.10 evalúan
  // sobre resultados validados por el Responsable de Calidad. Antes los
  // pendientes entraban en cumplimiento28d / peorTipo / tipoMayorCV y los
  // KPIs se movían cuando el operario cargaba un ensayo, antes de la firma.
  const ensayos28d = await db.EnsayoResistencia.findAll({
    where: { edadEnsayo: 28, pendienteRevision: false },
    attributes: ['resistencia'],
    include: ensayoInclude,
    raw: true,
    nest: true,
  });

  if (ensayos28d.length) {
    // Global compliance (each test vs its own target)
    let totalPass = 0;
    let totalWithTarget = 0;

    // Group by tipo for per-type stats
    const byTipo = {};
    for (const e of ensayos28d) {
      const tipo = e.probeta?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon;
      const target = parseTarget(tipo);
      const r = safe(e.resistencia);
      if (r <= 0) continue;
      if (target) {
        totalWithTarget++;
        if (r >= target) totalPass++;
      }
      const key = tipo || 'N/A';
      if (!byTipo[key]) byTipo[key] = { values: [], target };
      byTipo[key].values.push(r);
    }
    result.cumplimiento28d = totalWithTarget > 0 ? pct(totalPass, totalWithTarget) : null;

    // Compute per-type stats to find worst tipo and highest CV
    const tipoStats = Object.entries(byTipo)
      .filter(([, d]) => d.values.length >= 3 && d.target) // need >=3 samples with target
      .map(([tipo, d]) => {
        const vals = d.values;
        const n = vals.length;
        const mean = vals.reduce((a, b) => a + b, 0) / n;
        const variance = n > 1 ? vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) : 0;
        const sd = Math.sqrt(variance);
        const pass = d.target ? vals.filter(v => v >= d.target).length : n;
        return {
          tipo,
          n,
          mean: round2(mean),
          cv: mean > 0 ? round2((sd / mean) * 100) : 0,
          cumplimiento: pct(pass, n),
        };
      });

    result.totalTipos = tipoStats.length;
    result.tiposBajoControl = tipoStats.filter(t => t.cumplimiento >= 90).length;

    if (tipoStats.length) {
      // Worst compliance
      const worst = tipoStats.reduce((a, b) => a.cumplimiento < b.cumplimiento ? a : b);
      result.peorTipo = { tipo: worst.tipo, cumplimiento: worst.cumplimiento, n: worst.n };

      // Highest CV (most unstable)
      const highestCV = tipoStats.reduce((a, b) => a.cv > b.cv ? a : b);
      result.tipoMayorCV = { tipo: highestCV.tipo, cv: highestCV.cv, n: highestCV.n };
    }
  }

  return result;
}

/* ═══════════════════════════════════════
   2. Alerts
   ═══════════════════════════════════════ */
async function getAlerts(db, params, user) {
  const { where, idTipoHormigon } = buildWhere(params, user);
  const alerts = [];

  // Pending review ensayos (filtered by tipo if set)
  const muestras = await db.Muestra.findAll({
    attributes: ['idMuestra'],
    include: [buildDespachoInclude(db, where, idTipoHormigon)],
    raw: true,
  });
  const mIds = muestras.map(m => m.idMuestra);

  if (mIds.length) {
    const pendCount = await db.EnsayoResistencia.count({
      where: { pendienteRevision: 1 },
      include: [{ model: db.Probeta, as: 'probeta', attributes: [], where: { idMuestra: { [Op.in]: mIds } } }],
    });
    if (pendCount > 0) {
      alerts.push({
        severity: 'warn',
        icon: 'fa-solid fa-clock',
        message: `${pendCount} ensayo(s) pendiente(s) de revisión`,
        action: '/calidad/revisiones-ensayos',
      });
    }

    // Low compliance alert — solo sobre ensayos aprobados (Sprint 1 / C1).
    const ensayos28d = await db.EnsayoResistencia.findAll({
      where: { edadEnsayo: 28, pendienteRevision: false },
      attributes: ['resistencia'],
      include: [{
        model: db.Probeta, as: 'probeta', attributes: [],
        where: { idMuestra: { [Op.in]: mIds } },
        include: [{
          model: db.Muestra, as: 'muestra', attributes: [],
          include: [{
            model: db.Despacho, as: 'despacho', attributes: [],
            include: [{
              model: db.Dosificacion, as: 'dosificacion', attributes: [],
              include: [{ model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] }],
            }],
          }],
        }],
      }],
      raw: true,
      nest: true,
    });

    if (ensayos28d.length >= 5) {
      let pass = 0;
      for (const e of ensayos28d) {
        const tipo = e.probeta?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon;
        const target = parseTarget(tipo);
        if (target && safe(e.resistencia) >= target) pass++;
      }
      const compliance = pct(pass, ensayos28d.length);
      if (compliance < 90) {
        alerts.push({
          severity: 'error',
          icon: 'fa-solid fa-triangle-exclamation',
          message: `Cumplimiento 28d bajo: ${compliance}%`,
          action: '/calidad/control',
        });
      }
    }
  }

  // Sampling rate (filtered by tipo if set)
  const despSamplingInc = [];
  if (idTipoHormigon) {
    despSamplingInc.push({
      model: db.Dosificacion, as: 'dosificacion', attributes: [],
      where: { idTipoHormigon },
    });
  }
  const despAgg2 = await db.Despacho.findOne({
    where,
    include: despSamplingInc,
    attributes: [
      [fn('COUNT', col('idDespacho')), 'total'],
      [fn('SUM', literal('CASE WHEN tieneMuestra = 1 THEN 1 ELSE 0 END')), 'conMuestra'],
    ],
    raw: true,
  });
  const totalDesp = safe(despAgg2?.total);
  const conMuestra = safe(despAgg2?.conMuestra);
  if (totalDesp > 10 && pct(conMuestra, totalDesp) < 5) {
    alerts.push({
      severity: 'warn',
      icon: 'fa-solid fa-flask',
      message: `Tasa de muestreo baja: ${pct(conMuestra, totalDesp)}%`,
    });
  }

  return alerts;
}

/* ═══════════════════════════════════════
   3. Summary table: resistance by tipo hormigón
   ═══════════════════════════════════════ */
async function getSummaryByTipo(db, params, user) {
  const { where, idTipoHormigon } = buildWhere(params, user);

  const muestras = await db.Muestra.findAll({
    attributes: ['idMuestra'],
    include: [buildDespachoInclude(db, where, idTipoHormigon)],
    raw: true,
  });
  const mIds = muestras.map(m => m.idMuestra);
  if (!mIds.length) return [];

  // Summary por tipo — solo sobre ensayos aprobados (Sprint 1 / C1).
  const ensayos = await db.EnsayoResistencia.findAll({
    where: { edadEnsayo: 28, pendienteRevision: false },
    attributes: ['resistencia'],
    include: [{
      model: db.Probeta, as: 'probeta', attributes: [],
      where: { idMuestra: { [Op.in]: mIds } },
      include: [{
        model: db.Muestra, as: 'muestra', attributes: [],
        include: [{
          model: db.Despacho, as: 'despacho', attributes: [],
          include: [{
            model: db.Dosificacion, as: 'dosificacion', attributes: [],
            include: [{ model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] }],
          }],
        }],
      }],
    }],
    raw: true,
    nest: true,
  });

  const byTipo = {};
  for (const e of ensayos) {
    const tipo = e.probeta?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon || 'N/A';
    if (!byTipo[tipo]) byTipo[tipo] = [];
    const r = safe(e.resistencia);
    if (r > 0) byTipo[tipo].push(r);
  }

  return Object.entries(byTipo).map(([tipo, vals]) => {
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1 ? vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) : 0;
    const sd = Math.sqrt(variance);
    const target = parseTarget(tipo);
    const pass = target ? vals.filter(v => v >= target).length : n;

    return {
      tipoHormigon: tipo,
      n,
      media: round2(mean),
      desvio: round2(sd),
      cv: mean > 0 ? round2((sd / mean) * 100) : 0,
      fck: round2(mean - 1.28 * sd),
      target,
      cumplimiento: pct(pass, n),
      min: round2(Math.min(...vals)),
      max: round2(Math.max(...vals)),
    };
  }).sort((a, b) => b.n - a.n);
}

/* ═══════════════════════════════════════
   4. Control chart data (Shewhart)
   Supports two modes:
   - modo=absoluto (default): raw MPa — requires idTipoHormigon
   - modo=normalizado: resistance/target*100 (% of target) — allows cross-type
   ═══════════════════════════════════════ */
async function getControlChartData(db, params, user) {
  const { where, idTipoHormigon } = buildWhere(params, user);
  const normalizado = params.modo === 'normalizado';

  const dosInclude = {
    model: db.Dosificacion, as: 'dosificacion', attributes: ['idTipoHormigon'],
    include: [{ model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] }],
  };

  // If filtering by tipo hormigón — required: true forces INNER JOIN
  if (idTipoHormigon) {
    dosInclude.where = { idTipoHormigon };
    dosInclude.required = true;
  }

  // Carta Shewhart + Western Electric — solo sobre ensayos aprobados
  // (Sprint 1 / C1). El propio CUSUM también la consume vía esta función.
  const ensayos = await db.EnsayoResistencia.findAll({
    where: { edadEnsayo: { [Op.in]: [7, 28] }, pendienteRevision: false },
    attributes: ['resistencia', 'edadEnsayo', 'fechaEnsayo'],
    include: [{
      model: db.Probeta, as: 'probeta', attributes: ['idProbeta', 'nombre'],
      required: true,
      include: [{
        model: db.Muestra, as: 'muestra', attributes: ['idMuestra'],
        required: true,
        include: [{
          model: db.Despacho, as: 'despacho', attributes: ['fecha', 'remito'],
          where,
          required: true,
          include: [dosInclude],
        }],
      }],
    }],
    order: [['fechaEnsayo', 'ASC']],
    raw: true,
    nest: true,
  });

  // Group by edad
  const series = { 7: [], 28: [] };
  for (const e of ensayos) {
    const edad = e.edadEnsayo;
    const tipo = e.probeta?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon || 'N/A';
    const r = safe(e.resistencia);
    if (r <= 0) continue;
    const target = parseTarget(tipo);

    // In normalized mode, skip points without a parseable target
    if (normalizado && !target) continue;

    if (!series[edad]) series[edad] = [];
    series[edad].push({
      fecha: e.fechaEnsayo,
      fechaDespacho: e.probeta?.muestra?.despacho?.fecha,
      remito: e.probeta?.muestra?.despacho?.remito,
      resistencia: r,
      tipoHormigon: tipo,
      target,
      // In normalized mode, the chart value is % of target
      valor: normalizado ? round2((r / target) * 100) : r,
    });
  }

  // CTL-29 / A4 (sesión 2026-05-10): las stats Shewhart y las reglas
  // Western Electric pasan a engines puros en `domain/spc/`. Acá
  // delegamos. Si `points` está vacío, el resultado para esa edad es
  // shape mínimo (stats=null, westernElectric=[]).
  const result = { modo: normalizado ? 'normalizado' : 'absoluto' };
  for (const edad of [7, 28]) {
    const points = series[edad] || [];
    if (!points.length) {
      result[`edad${edad}`] = { points: [], stats: null, westernElectric: [] };
      continue;
    }
    const values = points.map(p => p.valor);
    const stats = computeShewhartStats(values);
    // computeShewhartStats redondea; para WE necesitamos mean/sd raw.
    const { mean: meanRaw, sd: sdRaw } = computeMeanSd(values);
    const violations = evaluateWesternElectric(values, meanRaw, sdRaw);
    result[`edad${edad}`] = { points, stats, westernElectric: violations };
  }

  return result;
}

/* CTL-29 / A4 (sesión 2026-05-10): `evaluateWesternElectric` se movió
   a `domain/spc/westernElectricEngine.js` como engine puro. Acá se
   consume vía import al inicio del archivo. */

/* ═══════════════════════════════════════
   5. Recent activity
   ═══════════════════════════════════════ */
async function getRecentActivity(db, params, user) {
  const { where, idTipoHormigon } = buildWhere(params, user);

  const despInc = buildDespachoInclude(db, where, idTipoHormigon, { despachoAttrs: ['fecha', 'remito'] });

  // Last 15 ensayos
  const ensayos = await db.EnsayoResistencia.findAll({
    attributes: ['idEnsayoResistencia', 'resistencia', 'edadEnsayo', 'fechaEnsayo', 'pendienteRevision'],
    include: [{
      model: db.Probeta, as: 'probeta', attributes: ['idProbeta', 'nombre', 'codigo'],
      required: true,
      include: [{
        model: db.Muestra, as: 'muestra', attributes: ['idMuestra'],
        required: true,
        include: [despInc],
      }],
    }],
    order: [['fechaEnsayo', 'DESC'], ['idEnsayoResistencia', 'DESC']],
    limit: 15,
    raw: true,
    nest: true,
  });

  return ensayos.map(e => ({
    idEnsayo: e.idEnsayoResistencia,
    probeta: e.probeta?.nombre || e.probeta?.codigo,
    resistencia: safe(e.resistencia),
    edadEnsayo: e.edadEnsayo,
    fechaEnsayo: e.fechaEnsayo,
    remito: e.probeta?.muestra?.despacho?.remito,
    fechaDespacho: e.probeta?.muestra?.despacho?.fecha,
    tipoHormigon: e.probeta?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon || 'N/A',
    pendiente: !!e.pendienteRevision,
  }));
}

/* ═══════════════════════════════════════
   6. Resistance evolution (monthly)
   When filtered by tipo → raw MPa with media/desvío/cv/fck
   When global (no tipo filter) → normalized % of target so mixed types are comparable
   ═══════════════════════════════════════ */
async function getResistanceEvolution(db, params, user) {
  const { where, idTipoHormigon } = buildWhere(params, user);
  const normalizado = !idTipoHormigon; // normalize when showing all types

  const despInc = buildDespachoInclude(db, where, idTipoHormigon);

  // Evolución mensual — solo sobre ensayos aprobados (Sprint 1 / C1).
  const ensayos = await db.EnsayoResistencia.findAll({
    where: { edadEnsayo: 28, pendienteRevision: false },
    attributes: ['resistencia', 'fechaEnsayo'],
    include: [{
      model: db.Probeta, as: 'probeta', attributes: [],
      required: true,
      include: [{
        model: db.Muestra, as: 'muestra', attributes: [],
        required: true,
        include: [despInc],
      }],
    }],
    raw: true,
    nest: true,
  });

  // Group by month
  const byMonth = {};
  for (const e of ensayos) {
    const r = safe(e.resistencia);
    if (r <= 0) continue;
    const tipo = e.probeta?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon;
    const target = parseTarget(tipo);
    // In normalized mode, skip tests without parseable target
    if (normalizado && !target) continue;
    const valor = normalizado ? (r / target) * 100 : r;

    const month = dayjs(e.fechaEnsayo).format('YYYY-MM');
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(valor);
  }

  return {
    normalizado,
    series: Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, vals]) => {
        const n = vals.length;
        const mean = vals.reduce((a, b) => a + b, 0) / n;
        const variance = n > 1 ? vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) : 0;
        const sd = Math.sqrt(variance);
        return {
          month,
          label: dayjs(month + '-01').locale('es').format('MMM YYYY'),
          n,
          media: round2(mean),
          desvio: round2(sd),
          cv: mean > 0 ? round2((sd / mean) * 100) : 0,
          fck: normalizado ? null : round2(mean - 1.28 * sd),
        };
      }),
  };
}

/* ═══════════════════════════════════════
   7. Available tipo hormigón list (for filters)
   ═══════════════════════════════════════ */
async function getTiposHormigon(db) {
  const rows = await db.TipoHormigon.findAll({
    attributes: ['idTipoHormigon', 'tipoHormigon'],
    order: [['tipoHormigon', 'ASC']],
    raw: true,
  });
  return rows;
}

/* ═══════════════════════════════════════
   CUSUM tabular (sesión 2026-05-09)
   ═══════════════════════════════════════
   Reutiliza la query base de `getControlChartData` (mismas series por
   edad 7d/28d) y aplica el engine puro `domain/spc/cusumEngine.js`.

   Parámetros opcionales:
     params.target — valor objetivo del proceso. Si no se especifica, se
                     usa la media de la serie (CUSUM "self-centered",
                     útil para detectar drift relativo al promedio
                     reciente, no contra spec).
     params.sigma  — desviación estándar del proceso. Default: σ muestral.
     params.kSigmas, params.hSigmas — overrides del slack y umbral.
*/
async function getCusumData(db, params, user) {
  const { calcularCusum } = require('../domain/spc/cusumEngine');
  const baseData = await getControlChartData(db, params, user);
  const result = { modo: baseData.modo };

  for (const edad of [7, 28]) {
    const edadKey = `edad${edad}`;
    const { points = [], stats } = baseData[edadKey] || {};
    if (!points.length || !stats) {
      result[edadKey] = { points: [], stats: null };
      continue;
    }

    const values = points.map((p) => (p.valor != null ? p.valor : p.resistencia));
    // Target prioridad: explícito → media de la serie. Sigma: explícito → σ muestral.
    const target = Number.isFinite(Number(params.target))
      ? Number(params.target)
      : stats.mean;
    const sigma = Number.isFinite(Number(params.sigma)) && Number(params.sigma) > 0
      ? Number(params.sigma)
      : ((stats.ucl - stats.mean) / 3); // backsolve from 3σ band
    const kSigmas = Number.isFinite(Number(params.kSigmas)) ? Number(params.kSigmas) : undefined;
    const hSigmas = Number.isFinite(Number(params.hSigmas)) ? Number(params.hSigmas) : undefined;

    const cusum = calcularCusum({ values, target, sigma, kSigmas, hSigmas });
    // Aumentamos cada punto CUSUM con la fecha y remito de la serie original
    // para que el frontend pueda mostrar contexto en el chart.
    cusum.points = cusum.points.map((p, i) => ({
      ...p,
      fecha: points[i]?.fecha,
      fechaDespacho: points[i]?.fechaDespacho,
      remito: points[i]?.remito,
      tipoHormigon: points[i]?.tipoHormigon,
    }));
    result[edadKey] = cusum;
  }

  return result;
}

/* ═══════════════════════════════════════
   Main consolidated endpoint
   ═══════════════════════════════════════ */
async function getDashboard(db, params, user) {
  const [kpis, alerts, summaryByTipo, recentActivity, evolution] = await Promise.all([
    getDashboardKpis(db, params, user),
    getAlerts(db, params, user),
    getSummaryByTipo(db, params, user),
    getRecentActivity(db, params, user),
    getResistanceEvolution(db, params, user),
  ]);

  return { kpis, alerts, summaryByTipo, recentActivity, evolution };
}

module.exports = {
  getDashboard,
  getDashboardKpis,
  getAlerts,
  getSummaryByTipo,
  getControlChartData,
  getRecentActivity,
  getResistanceEvolution,
  getTiposHormigon,
  evaluateWesternElectric,
  getCusumData,
};
