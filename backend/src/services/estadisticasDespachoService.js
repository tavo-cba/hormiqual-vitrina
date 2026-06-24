/**
 * estadisticasDespachoService.js
 *
 * Servicio de estadísticas avanzadas de despachos de hormigón.
 * Ejecuta agregaciones SQL (SUM, AVG, COUNT, GROUP BY) en el servidor
 * y devuelve un JSON consolidado listo para el dashboard del frontend.
 */
const { Op, fn, col, literal } = require('sequelize');
const { getDateRange } = require('../utils/date');
const dayjs = require('dayjs');
require('dayjs/locale/es');

/* ═══════════════════════════════════════
   Helpers
   ═══════════════════════════════════════ */

/** Construye la cláusula WHERE de Despacho reutilizando la lógica de despachoService */
function buildDespachoWhere(params, user) {
  const { idCliente, idObra, idPlanta, idDosificacion, idTipoHormigon, desde, hasta, rango } = params;

  let start = desde ? new Date(desde) : null;
  let end = hasta ? new Date(hasta) : null;
  if (rango && !start && !end) {
    const r = getDateRange(rango);
    start = r.desde;
    end = r.hasta;
  }

  const where = { activo: true };
  if (idCliente) where.idCliente = +idCliente;
  if (idObra) where.idObra = +idObra;
  if (idPlanta) where.idPlanta = +idPlanta;
  if (idDosificacion) where.idDosificacion = +idDosificacion;

  // Permisos por planta
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

  if (start || end) {
    where.fecha = {
      ...(start && { [Op.gte]: start }),
      ...(end && { [Op.lte]: end }),
    };
  }

  return { where, start, end, idTipoHormigon: idTipoHormigon ? +idTipoHormigon : null };
}

/** Calcula el período anterior equivalente para comparaciones */
function getPreviousPeriod(start, end) {
  if (!start || !end) return { prevStart: null, prevEnd: null };
  const diff = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - diff);
  return { prevStart, prevEnd };
}

/** Haversine distance en km */
function haversineKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Parsea target de resistencia de "H-25" → 25 */
function parseResistenciaTarget(tipoHormigon) {
  if (!tipoHormigon) return null;
  const match = tipoHormigon.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

const safe = (v, fallback = 0) => (v != null ? Number(v) : fallback);
const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : 0);
const round2 = (n) => Math.round((n || 0) * 100) / 100;

/* ═══════════════════════════════════════
   Helpers: Financials vinculados a despachos
   ═══════════════════════════════════════ */

/** Construye WHERE SQL para tabla Despacho (alias 'd') con replacements parametrizados */
function buildDespachoSqlConditions(where) {
  const conditions = ['d.activo = 1'];
  const replacements = {};
  if (where.idPlanta) {
    if (typeof where.idPlanta === 'object' && where.idPlanta[Op.in]) {
      conditions.push('d.idPlanta IN (:plantaIds)');
      replacements.plantaIds = where.idPlanta[Op.in];
    } else if (where.idPlanta === 0) {
      conditions.push('1 = 0');
    } else {
      conditions.push('d.idPlanta = :idPlanta');
      replacements.idPlanta = +where.idPlanta;
    }
  }
  if (where.idCliente) { conditions.push('d.idCliente = :dIdCliente'); replacements.dIdCliente = +where.idCliente; }
  if (where.idObra) { conditions.push('d.idObra = :dIdObra'); replacements.dIdObra = +where.idObra; }
  if (where.fecha) {
    if (where.fecha[Op.gte]) { conditions.push('d.fecha >= :dFechaDesde'); replacements.dFechaDesde = dayjs(where.fecha[Op.gte]).format('YYYY-MM-DD'); }
    if (where.fecha[Op.lte]) { conditions.push('d.fecha <= :dFechaHasta'); replacements.dFechaHasta = dayjs(where.fecha[Op.lte]).format('YYYY-MM-DD'); }
  }
  return { sql: conditions.join(' AND '), replacements };
}

/**
 * Obtiene IDs de facturas vinculadas a despachos filtrados + totales netos de NC.
 * Dos cadenas (UNION dedupe):
 *   A) Despacho → RemitoVenta.idFacturaVenta → FacturaVenta  (factura por remito)
 *   B) Despacho → Pedido → OrdenVenta ← FacturaVenta.idOrdenVenta  (factura por orden)
 * NC/ND se detectan via tipoComprobante LIKE '%CREDITO%' / '%DEBITO%'
 */
async function getHormigonFinancials(db, where) {
  const { sql: dWhere, replacements } = buildDespachoSqlConditions(where);

  // 1. Factura IDs por cualquiera de las dos cadenas
  const [factRowsRemito, factRowsOrden] = await Promise.all([
    db.sequelize.query(`
      SELECT DISTINCT rv.idFacturaVenta
      FROM RemitoVenta rv
      INNER JOIN Despacho d ON rv.idDespacho = d.idDespacho
      WHERE ${dWhere} AND rv.idFacturaVenta IS NOT NULL
    `, { type: db.sequelize.QueryTypes.SELECT, replacements }),
    db.sequelize.query(`
      SELECT DISTINCT f.idFacturaVenta
      FROM FacturaVenta f
      INNER JOIN Pedido p ON p.idOrdenVenta = f.idOrdenVenta
      INNER JOIN Despacho d ON d.idPedido = p.idPedido
      WHERE ${dWhere} AND p.idOrdenVenta IS NOT NULL
    `, { type: db.sequelize.QueryTypes.SELECT, replacements }),
  ]);
  const facturaIds = [...new Set([
    ...factRowsRemito.map(r => r.idFacturaVenta),
    ...factRowsOrden.map(r => r.idFacturaVenta),
  ])];

  if (!facturaIds.length) {
    return { facturaIds: [], allFacturaIds: [], facturacionNeta: 0, facturacionBruta: 0, totalNC: 0, cobradoTotal: 0 };
  }

  // 2. Incluir NC/ND que referencian nuestras facturas (las NC no tienen remito)
  const ncRows = await db.sequelize.query(`
    SELECT DISTINCT nc.idFacturaVenta
    FROM FacturaVenta nc
    WHERE nc.idFacturaVentaAsociada IN (:facturaIds) AND nc.estado != 'anulada'
  `, { type: db.sequelize.QueryTypes.SELECT, replacements: { facturaIds } });
  const allFacturaIds = [...new Set([...facturaIds, ...ncRows.map(r => r.idFacturaVenta)])];

  // 3. Facturación neta: facturas + ND - NC
  const [netRow] = await db.sequelize.query(`
    SELECT
      COALESCE(SUM(CASE WHEN f.tipoComprobante LIKE '%CREDITO%' THEN -f.total ELSE f.total END), 0) as neto,
      COALESCE(SUM(CASE WHEN f.tipoComprobante NOT LIKE '%CREDITO%' AND f.tipoComprobante NOT LIKE '%DEBITO%' THEN f.total ELSE 0 END), 0) as bruto,
      COALESCE(SUM(CASE WHEN f.tipoComprobante LIKE '%CREDITO%' THEN f.total ELSE 0 END), 0) as totalNC
    FROM FacturaVenta f
    WHERE f.idFacturaVenta IN (:allFacturaIds) AND f.estado != 'anulada'
  `, { type: db.sequelize.QueryTypes.SELECT, replacements: { allFacturaIds } });

  // 4. Cobrado vinculado a estas facturas (CobranzaFactura + legacy)
  let cobradoTotal = 0;
  try {
    const [cobRow] = await db.sequelize.query(`
      SELECT COALESCE(SUM(amount), 0) as total FROM (
        SELECT cf.importeAplicado as amount
        FROM CobranzaFactura cf
        INNER JOIN Cobranza c ON cf.idCobranza = c.idCobranza
        WHERE cf.idFacturaVenta IN (:allFacturaIds) AND c.tipo = 'cobro'
        UNION ALL
        SELECT c.importe as amount
        FROM Cobranza c
        WHERE c.idFacturaVenta IN (:allFacturaIds) AND c.tipo = 'cobro'
          AND NOT EXISTS (SELECT 1 FROM CobranzaFactura cf2 WHERE cf2.idCobranza = c.idCobranza)
      ) sub
    `, { type: db.sequelize.QueryTypes.SELECT, replacements: { allFacturaIds } });
    cobradoTotal = safe(cobRow?.total);
  } catch {
    // Fallback legacy sin CobranzaFactura
    try {
      const [cobLegacy] = await db.sequelize.query(`
        SELECT COALESCE(SUM(c.importe), 0) as total
        FROM Cobranza c
        WHERE c.idFacturaVenta IN (:facturaIds) AND c.tipo = 'cobro'
      `, { type: db.sequelize.QueryTypes.SELECT, replacements: { facturaIds } });
      cobradoTotal = safe(cobLegacy?.total);
    } catch { }
  }

  return {
    facturaIds,
    allFacturaIds,
    facturacionNeta: safe(netRow?.neto),
    facturacionBruta: safe(netRow?.bruto),
    totalNC: safe(netRow?.totalNC),
    cobradoTotal,
  };
}

/* ═══════════════════════════════════════
   Sección 1: KPIs principales
   ═══════════════════════════════════════ */
async function getKpi(db, where, start, end, hormigonData) {
  // --- Despachos ---
  const despachoAgg = await db.Despacho.findOne({
    where,
    attributes: [
      [fn('SUM', col('volumenDepacho')), 'totalVolumen'],
      [fn('COUNT', col('idDespacho')), 'totalDespachos'],
    ],
    raw: true,
  });
  const totalVolumen = safe(despachoAgg.totalVolumen);
  const totalDespachos = safe(despachoAgg.totalDespachos);

  // --- Facturación y cobrado (solo facturas vinculadas a despachos, neto de NC) ---
  const facturacionTotal = hormigonData.facturacionNeta;
  const cobradoTotal = hormigonData.cobradoTotal;

  // --- Tiempos (RemitoVenta) ---
  let promedioViajeIda = null;
  let promedioCicloCompleto = null;
  try {
    const tiemposAgg = await db.RemitoVenta.findOne({
      attributes: [
        [fn('AVG', literal('TIMESTAMPDIFF(MINUTE, `RemitoVenta`.`dejoPlanta`, `RemitoVenta`.`llegoObra`)')), 'avgIda'],
        [fn('AVG', literal('TIMESTAMPDIFF(MINUTE, `RemitoVenta`.`dejoPlanta`, `RemitoVenta`.`llegoPlanta`)')), 'avgCiclo'],
      ],
      include: [{
        model: db.Despacho, as: 'despacho', attributes: [], where,
      }],
      where: {
        dejoPlanta: { [Op.ne]: null },
        llegoObra: { [Op.ne]: null },
      },
      raw: true,
    });
    promedioViajeIda = tiemposAgg?.avgIda != null ? round2(tiemposAgg.avgIda) : null;
    promedioCicloCompleto = tiemposAgg?.avgCiclo != null ? round2(tiemposAgg.avgCiclo) : null;
  } catch { /* tabla puede no tener datos */ }

  // --- Calidad 28d ---
  let cumplimientoCalidad = null;
  try {
    const ensayos28d = await db.EnsayoResistencia.findAll({
      where: { edadEnsayo: 28 },
      attributes: ['resistencia'],
      include: [{
        model: db.Probeta, as: 'probeta',
        attributes: [],
        include: [{
          model: db.Muestra, as: 'muestra',
          attributes: [],
          include: [{
            model: db.Despacho, as: 'despacho',
            attributes: [],
            where,
            include: [{
              model: db.Dosificacion, as: 'dosificacion',
              attributes: [],
              include: [{ model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] }],
            }],
          }],
        }],
      }],
      raw: true,
      nest: true,
    });

    if (ensayos28d.length > 0) {
      let pass = 0;
      for (const e of ensayos28d) {
        const tipo = e.probeta?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon;
        const target = parseResistenciaTarget(tipo);
        if (target && safe(e.resistencia) >= target) pass++;
      }
      cumplimientoCalidad = pct(pass, ensayos28d.length);
    }
  } catch { /* cadena de relaciones puede fallar */ }

  // --- Comparación con período anterior ---
  let comparacion = {};
  const { prevStart, prevEnd } = getPreviousPeriod(start, end);
  if (prevStart && prevEnd) {
    const prevWhere = { ...where, fecha: { [Op.gte]: prevStart, [Op.lte]: prevEnd } };
    const prevAgg = await db.Despacho.findOne({
      where: prevWhere,
      attributes: [
        [fn('SUM', col('volumenDepacho')), 'totalVolumen'],
        [fn('COUNT', col('idDespacho')), 'totalDespachos'],
      ],
      raw: true,
    });
    const prevVol = safe(prevAgg?.totalVolumen);
    const prevDesp = safe(prevAgg?.totalDespachos);

    let prevFacturacion = 0;
    try {
      const prevWhere = { ...where, fecha: { [Op.gte]: prevStart, [Op.lte]: prevEnd } };
      const prevHormigon = await getHormigonFinancials(db, prevWhere);
      prevFacturacion = prevHormigon.facturacionNeta;
    } catch { }

    comparacion = {
      totalVolumen: { anterior: prevVol, variacion: pct(totalVolumen - prevVol, prevVol || 1) },
      totalDespachos: { anterior: prevDesp, variacion: pct(totalDespachos - prevDesp, prevDesp || 1) },
      facturacionTotal: { anterior: prevFacturacion, variacion: pct(facturacionTotal - prevFacturacion, prevFacturacion || 1) },
    };
  }

  return {
    totalVolumen,
    totalDespachos,
    facturacionTotal,
    cobradoTotal,
    tasaCobranza: pct(cobradoTotal, facturacionTotal),
    promedioViajeIda,
    promedioCicloCompleto,
    cumplimientoCalidad,
    comparacion,
  };
}

/* ═══════════════════════════════════════
   Sección 2: Financiero
   ═══════════════════════════════════════ */
async function getFinancial(db, where, start, end, hormigonData) {
  const result = {
    ingresoPorM3: 0, ingresoPorDespacho: 0,
    facturacionMensual: [], topClientesFacturacion: [],
    porFormaPago: [], diasPromedioCobro: null,
    saldoPendiente: 0, porMoneda: {},
  };

  try {
    // Despacho totals for ratio calculation
    const despAgg = await db.Despacho.findOne({
      where,
      attributes: [
        [fn('SUM', col('volumenDepacho')), 'totalVol'],
        [fn('COUNT', col('idDespacho')), 'totalDesp'],
      ],
      raw: true,
    });
    const totalVol = safe(despAgg?.totalVol);
    const totalDesp = safe(despAgg?.totalDesp);

    const facturacion = hormigonData.facturacionNeta;
    result.ingresoPorM3 = totalVol ? round2(facturacion / totalVol) : 0;
    result.ingresoPorDespacho = totalDesp ? round2(facturacion / totalDesp) : 0;
    result.saldoPendiente = round2(facturacion - hormigonData.cobradoTotal);

    const allIds = hormigonData.allFacturaIds;
    if (allIds.length) {
      // Facturación mensual (neto de NC por mes)
      result.facturacionMensual = await db.sequelize.query(`
        SELECT DATE_FORMAT(f.fecha, '%Y-%m') as mes,
          SUM(CASE WHEN f.tipoComprobante LIKE '%CREDITO%' THEN -f.total ELSE f.total END) as total
        FROM FacturaVenta f
        WHERE f.idFacturaVenta IN (:allIds) AND f.estado != 'anulada'
        GROUP BY DATE_FORMAT(f.fecha, '%Y-%m')
        ORDER BY mes ASC
      `, { type: db.sequelize.QueryTypes.SELECT, replacements: { allIds } })
        .then(rows => rows.map(r => ({ mes: r.mes, total: safe(r.total) })));

      // Top 10 clientes por facturación neta
      result.topClientesFacturacion = await db.sequelize.query(`
        SELECT f.idCliente,
          COALESCE(cl.razonSocial, CONCAT(COALESCE(cl.nombre,''), ' ', COALESCE(cl.apellido,''))) as nombre,
          SUM(CASE WHEN f.tipoComprobante LIKE '%CREDITO%' THEN -f.total ELSE f.total END) as total
        FROM FacturaVenta f
        LEFT JOIN Cliente cl ON f.idCliente = cl.idCliente
        WHERE f.idFacturaVenta IN (:allIds) AND f.estado != 'anulada'
        GROUP BY f.idCliente
        ORDER BY total DESC
        LIMIT 10
      `, { type: db.sequelize.QueryTypes.SELECT, replacements: { allIds } })
        .then(rows => rows.map(r => ({
          idCliente: r.idCliente,
          nombre: (r.nombre || '').trim(),
          total: safe(r.total),
        })));

      // Por forma de pago (cobranzas vinculadas a facturas de hormigón)
      try {
        result.porFormaPago = await db.sequelize.query(`
          SELECT c.formaPago, COALESCE(SUM(sub.amount), 0) as total FROM (
            SELECT cf.idCobranza, cf.importeAplicado as amount
            FROM CobranzaFactura cf
            WHERE cf.idFacturaVenta IN (:allIds)
            UNION ALL
            SELECT c2.idCobranza, c2.importe as amount
            FROM Cobranza c2
            WHERE c2.idFacturaVenta IN (:allIds) AND c2.tipo = 'cobro'
              AND NOT EXISTS (SELECT 1 FROM CobranzaFactura cf2 WHERE cf2.idCobranza = c2.idCobranza)
          ) sub
          INNER JOIN Cobranza c ON sub.idCobranza = c.idCobranza
          WHERE c.tipo = 'cobro'
          GROUP BY c.formaPago
          ORDER BY total DESC
        `, { type: db.sequelize.QueryTypes.SELECT, replacements: { allIds } })
          .then(rows => rows.map(r => ({ formaPago: r.formaPago, total: safe(r.total) })));
      } catch {
        result.porFormaPago = await db.Cobranza.findAll({
          where: { tipo: 'cobro', idFacturaVenta: { [Op.in]: hormigonData.facturaIds } },
          attributes: ['formaPago', [fn('SUM', col('importe')), 'total']],
          group: ['formaPago'],
          order: [[literal('total'), 'DESC']],
          raw: true,
        }).then(rows => rows.map(r => ({ formaPago: r.formaPago, total: safe(r.total) })));
      }

      // Días promedio de cobro (solo facturas de hormigón)
      const diasCobro = await db.sequelize.query(`
        SELECT AVG(DATEDIFF(c.fecha, f.fecha)) as promedio
        FROM Cobranza c
        INNER JOIN FacturaVenta f ON c.idFacturaVenta = f.idFacturaVenta
        WHERE c.tipo = 'cobro'
          AND f.idFacturaVenta IN (:facturaIds)
          AND f.estado != 'anulada'
      `, { type: db.sequelize.QueryTypes.SELECT, replacements: { facturaIds: hormigonData.facturaIds } });
      result.diasPromedioCobro = diasCobro[0]?.promedio != null ? round2(diasCobro[0].promedio) : null;

      // Por moneda (desde facturas de hormigón → OrdenVenta)
      const monedaRows = await db.sequelize.query(`
        SELECT COALESCE(ov.moneda, 'ARS') as moneda,
          SUM(CASE WHEN f.tipoComprobante LIKE '%CREDITO%' THEN -f.total ELSE f.total END) as total
        FROM FacturaVenta f
        LEFT JOIN OrdenVenta ov ON f.idOrdenVenta = ov.idOrdenVenta
        WHERE f.idFacturaVenta IN (:allIds) AND f.estado != 'anulada'
        GROUP BY COALESCE(ov.moneda, 'ARS')
      `, { type: db.sequelize.QueryTypes.SELECT, replacements: { allIds } });
      for (const r of monedaRows) {
        result.porMoneda[r.moneda || 'ARS'] = safe(r.total);
      }
    }
  } catch (err) {
    console.error('[estadisticas] Financial error:', err.message);
  }

  return result;
}

/* ═══════════════════════════════════════
   Sección 3: Operaciones
   ═══════════════════════════════════════ */
async function getOperational(db, where) {
  const result = {
    tiempos: { ida: {}, descarga: {}, vuelta: {}, enObra: {}, cicloCompleto: {} },
    porVehiculo: [], porChofer: [],
    distribucionHoraria: {},
    utilizacionPlanta: [],
    retiroEnPlanta: { retira: 0, entrega: 0 },
    confirmacionHorario: { confirmados: 0, sinConfirmar: 0 },
    distanciasObra: [],
  };

  try {
    // --- Tiempos de RemitoVenta ---
    const tiemposRaw = await db.sequelize.query(`
      SELECT
        AVG(TIMESTAMPDIFF(MINUTE, rv.dejoPlanta, rv.llegoObra)) as avgIda,
        MIN(TIMESTAMPDIFF(MINUTE, rv.dejoPlanta, rv.llegoObra)) as minIda,
        MAX(TIMESTAMPDIFF(MINUTE, rv.dejoPlanta, rv.llegoObra)) as maxIda,
        AVG(TIMESTAMPDIFF(MINUTE, rv.comenzoDescarga, rv.terminoDescarga)) as avgDescarga,
        MIN(TIMESTAMPDIFF(MINUTE, rv.comenzoDescarga, rv.terminoDescarga)) as minDescarga,
        MAX(TIMESTAMPDIFF(MINUTE, rv.comenzoDescarga, rv.terminoDescarga)) as maxDescarga,
        AVG(TIMESTAMPDIFF(MINUTE, rv.dejoObra, rv.llegoPlanta)) as avgVuelta,
        MIN(TIMESTAMPDIFF(MINUTE, rv.dejoObra, rv.llegoPlanta)) as minVuelta,
        MAX(TIMESTAMPDIFF(MINUTE, rv.dejoObra, rv.llegoPlanta)) as maxVuelta,
        AVG(TIMESTAMPDIFF(MINUTE, rv.llegoObra, rv.dejoObra)) as avgEnObra,
        MIN(TIMESTAMPDIFF(MINUTE, rv.llegoObra, rv.dejoObra)) as minEnObra,
        MAX(TIMESTAMPDIFF(MINUTE, rv.llegoObra, rv.dejoObra)) as maxEnObra,
        AVG(TIMESTAMPDIFF(MINUTE, rv.dejoPlanta, rv.llegoPlanta)) as avgCiclo,
        MIN(TIMESTAMPDIFF(MINUTE, rv.dejoPlanta, rv.llegoPlanta)) as minCiclo,
        MAX(TIMESTAMPDIFF(MINUTE, rv.dejoPlanta, rv.llegoPlanta)) as maxCiclo
      FROM RemitoVenta rv
      INNER JOIN Despacho d ON rv.idDespacho = d.idDespacho
      WHERE rv.dejoPlanta IS NOT NULL
        AND d.activo = 1
        ${where.idPlanta ? (typeof where.idPlanta === 'object' ? '' : `AND d.idPlanta = ${where.idPlanta}`) : ''}
        ${where.idCliente ? `AND d.idCliente = ${where.idCliente}` : ''}
        ${where.fecha?.[Op.gte] ? `AND d.fecha >= '${dayjs(where.fecha[Op.gte]).format('YYYY-MM-DD')}'` : ''}
        ${where.fecha?.[Op.lte] ? `AND d.fecha <= '${dayjs(where.fecha[Op.lte]).format('YYYY-MM-DD')}'` : ''}
    `, { type: db.sequelize.QueryTypes.SELECT });

    if (tiemposRaw[0]) {
      const t = tiemposRaw[0];
      result.tiempos.ida = { promedio: round2(t.avgIda), min: safe(t.minIda), max: safe(t.maxIda) };
      result.tiempos.descarga = { promedio: round2(t.avgDescarga), min: safe(t.minDescarga), max: safe(t.maxDescarga) };
      result.tiempos.vuelta = { promedio: round2(t.avgVuelta), min: safe(t.minVuelta), max: safe(t.maxVuelta) };
      result.tiempos.enObra = { promedio: round2(t.avgEnObra), min: safe(t.minEnObra), max: safe(t.maxEnObra) };
      result.tiempos.cicloCompleto = { promedio: round2(t.avgCiclo), min: safe(t.minCiclo), max: safe(t.maxCiclo) };
    }

    // --- Por vehículo ---
    result.porVehiculo = await db.Despacho.findAll({
      where: { ...where, idVehiculo: { [Op.ne]: null } },
      attributes: [
        'idVehiculo',
        [fn('COUNT', col('idDespacho')), 'despachos'],
        [fn('SUM', col('volumenDepacho')), 'm3'],
      ],
      include: [{ model: db.Vehiculo, as: 'vehiculo', attributes: ['patente', 'interno'] }],
      group: ['idVehiculo'],
      order: [[literal('m3'), 'DESC']],
      limit: 20,
      raw: true,
      nest: true,
    }).then(rows => rows.map(r => ({
      idVehiculo: r.idVehiculo,
      interno: r.vehiculo?.interno || r.vehiculo?.patente || `#${r.idVehiculo}`,
      patente: r.vehiculo?.patente,
      despachos: safe(r.despachos),
      m3: round2(r.m3),
    })));

    // --- Por chofer ---
    result.porChofer = await db.Despacho.findAll({
      where: { ...where, idEmpleado: { [Op.ne]: null } },
      attributes: [
        'idEmpleado',
        [fn('COUNT', col('idDespacho')), 'despachos'],
        [fn('SUM', col('volumenDepacho')), 'm3'],
      ],
      include: [{ model: db.Empleado, as: 'chofer', attributes: ['nombre', 'apellido'] }],
      group: ['idEmpleado'],
      order: [[literal('m3'), 'DESC']],
      limit: 20,
      raw: true,
      nest: true,
    }).then(rows => rows.map(r => ({
      idEmpleado: r.idEmpleado,
      nombre: `${r.chofer?.apellido || ''}, ${r.chofer?.nombre || ''}`.trim(),
      despachos: safe(r.despachos),
      m3: round2(r.m3),
    })));

    // --- Distribución horaria ---
    const horasRaw = await db.Despacho.findAll({
      where: { ...where, hora: { [Op.ne]: null, [Op.ne]: '00:00:00' } },
      attributes: [
        [fn('HOUR', col('hora')), 'hora'],
        [fn('COUNT', col('idDespacho')), 'cantidad'],
      ],
      group: [literal("HOUR(`hora`)")],
      order: [[literal('hora'), 'ASC']],
      raw: true,
    });
    for (const r of horasRaw) {
      result.distribucionHoraria[String(r.hora).padStart(2, '0')] = safe(r.cantidad);
    }

    // --- Utilización planta ---
    const plantaAgg = await db.Despacho.findAll({
      where,
      attributes: [
        'idPlanta',
        [fn('SUM', col('volumenDepacho')), 'totalM3'],
        [fn('COUNT', literal('DISTINCT `fecha`')), 'diasActivos'],
      ],
      include: [{ model: db.Planta, as: 'planta', attributes: ['nombre', 'capacidad', 'latitud', 'longitud'] }],
      group: ['idPlanta'],
      raw: true,
      nest: true,
    });
    result.utilizacionPlanta = plantaAgg.map(r => {
      const totalM3 = safe(r.totalM3);
      const dias = safe(r.diasActivos) || 1;
      const m3Dia = round2(totalM3 / dias);
      const cap = parseFloat(r.planta?.capacidad) || 0;
      return {
        idPlanta: r.idPlanta,
        nombre: r.planta?.nombre || `Planta ${r.idPlanta}`,
        totalM3: round2(totalM3),
        diasActivos: dias,
        m3Dia,
        capacidad: cap,
        porcentaje: cap ? round2((m3Dia / cap) * 100) : null,
      };
    });

    // --- Retiro en planta ---
    const retiroAgg = await db.Despacho.findAll({
      where,
      attributes: [
        'retiraEnPlanta',
        [fn('COUNT', col('idDespacho')), 'cantidad'],
      ],
      group: ['retiraEnPlanta'],
      raw: true,
    });
    for (const r of retiroAgg) {
      if (r.retiraEnPlanta) result.retiroEnPlanta.retira = safe(r.cantidad);
      else result.retiroEnPlanta.entrega = safe(r.cantidad);
    }

    // --- Confirmación horario ---
    const confAgg = await db.Despacho.findAll({
      where,
      attributes: [
        'confirmacionHorario',
        [fn('COUNT', col('idDespacho')), 'cantidad'],
      ],
      group: ['confirmacionHorario'],
      raw: true,
    });
    for (const r of confAgg) {
      if (r.confirmacionHorario) result.confirmacionHorario.confirmados = safe(r.cantidad);
      else result.confirmacionHorario.sinConfirmar = safe(r.cantidad);
    }

    // --- Distancias planta-obra ---
    const obrasConCoords = await db.Despacho.findAll({
      where: { ...where, idObra: { [Op.ne]: null } },
      attributes: [
        'idObra', 'idPlanta',
        [fn('SUM', col('volumenDepacho')), 'm3'],
        [fn('COUNT', col('idDespacho')), 'despachos'],
      ],
      include: [
        { model: db.Obra, as: 'obra', attributes: ['nombre', 'latitud', 'longitud'] },
        { model: db.Planta, as: 'planta', attributes: ['nombre', 'latitud', 'longitud'] },
      ],
      group: ['idObra', 'idPlanta'],
      raw: true,
      nest: true,
    });
    result.distanciasObra = obrasConCoords
      .map(r => {
        const dist = haversineKm(
          r.planta?.latitud, r.planta?.longitud,
          r.obra?.latitud, r.obra?.longitud
        );
        return {
          obra: r.obra?.nombre || `Obra ${r.idObra}`,
          planta: r.planta?.nombre || `Planta ${r.idPlanta}`,
          distanciaKm: dist ? round2(dist) : null,
          m3: round2(r.m3),
          despachos: safe(r.despachos),
        };
      })
      .filter(r => r.distanciaKm != null)
      .sort((a, b) => b.distanciaKm - a.distanciaKm)
      .slice(0, 10);

  } catch (err) {
    console.error('[estadisticas] Operational error:', err.message);
  }

  return result;
}

/* ═══════════════════════════════════════
   Sección 4: Flota y Combustible
   ═══════════════════════════════════════ */
async function getFleet(db, where, start, end) {
  const result = {
    totalLitros: 0,
    porVehiculo: [],
    porTipoCombustible: [],
    tendencia: [],
    litrosPorM3Global: null,
  };

  try {
    // Vehículos que despacharon en el período
    const vehicleIdsRaw = await db.Despacho.findAll({
      where: { ...where, idVehiculo: { [Op.ne]: null } },
      attributes: [[fn('DISTINCT', col('idVehiculo')), 'idVehiculo']],
      raw: true,
    });
    const vehicleIds = vehicleIdsRaw.map(r => r.idVehiculo).filter(Boolean);
    if (!vehicleIds.length) return result;

    const dateFilter = {};
    if (start) dateFilter[Op.gte] = start;
    if (end) dateFilter[Op.lte] = end;
    const combustibleWhere = {
      idVehiculo: { [Op.in]: vehicleIds },
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
    };

    // Total litros
    const totalAgg = await db.RegistroCombustible.findOne({
      where: combustibleWhere,
      attributes: [[fn('SUM', col('litros')), 'total']],
      raw: true,
    });
    result.totalLitros = round2(totalAgg?.total);

    // Por vehículo
    const fuelByVeh = await db.RegistroCombustible.findAll({
      where: combustibleWhere,
      attributes: [
        'idVehiculo',
        [fn('SUM', col('litros')), 'totalLitros'],
        [fn('MAX', col('kilometros')), 'maxKm'],
        [fn('MIN', col('kilometros')), 'minKm'],
        [fn('MAX', col('horas')), 'maxHoras'],
        [fn('MIN', col('horas')), 'minHoras'],
      ],
      group: ['idVehiculo'],
      raw: true,
    });

    // m3 por vehículo para litros/m3
    const m3ByVeh = await db.Despacho.findAll({
      where: { ...where, idVehiculo: { [Op.in]: vehicleIds } },
      attributes: [
        'idVehiculo',
        [fn('SUM', col('volumenDepacho')), 'm3'],
      ],
      group: ['idVehiculo'],
      raw: true,
    });
    const m3Map = {};
    for (const r of m3ByVeh) m3Map[r.idVehiculo] = safe(r.m3);

    // Info de vehículos
    const vehicles = await db.Vehiculo.findAll({
      where: { idVehiculo: vehicleIds },
      attributes: ['idVehiculo', 'patente', 'interno'],
      raw: true,
    });
    const vehMap = {};
    for (const v of vehicles) vehMap[v.idVehiculo] = v;

    let totalLitrosGlobal = 0;
    let totalM3Global = 0;
    result.porVehiculo = fuelByVeh.map(r => {
      const litros = safe(r.totalLitros);
      const m3 = m3Map[r.idVehiculo] || 0;
      const v = vehMap[r.idVehiculo] || {};
      const kmDelta = (r.maxKm && r.minKm) ? r.maxKm - r.minKm : null;
      const horasDelta = (r.maxHoras && r.minHoras) ? r.maxHoras - r.minHoras : null;
      totalLitrosGlobal += litros;
      totalM3Global += m3;
      return {
        idVehiculo: r.idVehiculo,
        interno: v.interno || v.patente || `#${r.idVehiculo}`,
        patente: v.patente,
        totalLitros: round2(litros),
        litrosPorM3: m3 ? round2(litros / m3) : null,
        kmDelta: kmDelta != null ? Math.round(kmDelta) : null,
        horasDelta: horasDelta != null ? Math.round(horasDelta) : null,
      };
    }).sort((a, b) => b.totalLitros - a.totalLitros);

    result.litrosPorM3Global = totalM3Global ? round2(totalLitrosGlobal / totalM3Global) : null;

    // Por tipo combustible
    result.porTipoCombustible = await db.RegistroCombustible.findAll({
      where: combustibleWhere,
      attributes: ['tipoCombustible', [fn('SUM', col('litros')), 'total']],
      group: ['tipoCombustible'],
      order: [[literal('total'), 'DESC']],
      raw: true,
    }).then(rows => rows.map(r => ({ tipo: r.tipoCombustible, litros: round2(r.total) })));

    // Tendencia diaria
    result.tendencia = await db.RegistroCombustible.findAll({
      where: combustibleWhere,
      attributes: [
        [fn('DATE', col('createdAt')), 'fecha'],
        [fn('SUM', col('litros')), 'litros'],
      ],
      group: [literal("DATE(`createdAt`)")],
      order: [[literal('fecha'), 'ASC']],
      raw: true,
    }).then(rows => rows.map(r => ({ fecha: r.fecha, litros: round2(r.litros) })));

  } catch (err) {
    console.error('[estadisticas] Fleet error:', err.message);
  }

  return result;
}

/* ═══════════════════════════════════════
   Sección 5: Clientes
   ═══════════════════════════════════════ */
async function getClients(db, where, start, end, hormigonData) {
  const result = {
    topPorVolumen: [], concentracion: [],
    nuevosVsRecurrentes: { nuevos: 0, recurrentes: 0 },
    estadoCuenta: [], ingresoM3PorCliente: [],
  };

  try {
    // Top 10 clientes por m³
    result.topPorVolumen = await db.Despacho.findAll({
      where,
      attributes: [
        'idCliente',
        [fn('SUM', col('volumenDepacho')), 'm3'],
        [fn('COUNT', col('idDespacho')), 'despachos'],
      ],
      include: [{
        model: db.Cliente, as: 'cliente',
        attributes: ['razonSocial', 'nombre', 'apellido', 'tipoPersona'],
      }],
      group: ['idCliente'],
      order: [[literal('m3'), 'DESC']],
      limit: 10,
      raw: true,
      nest: true,
    }).then(rows => rows.map(r => ({
      idCliente: r.idCliente,
      nombre: r.cliente?.razonSocial || `${r.cliente?.nombre || ''} ${r.cliente?.apellido || ''}`.trim(),
      m3: round2(r.m3),
      despachos: safe(r.despachos),
    })));

    // Concentración (Pareto) - todos los clientes para acumulado
    const allClientes = await db.Despacho.findAll({
      where,
      attributes: [
        'idCliente',
        [fn('SUM', col('volumenDepacho')), 'm3'],
      ],
      include: [{
        model: db.Cliente, as: 'cliente',
        attributes: ['razonSocial', 'nombre', 'apellido'],
      }],
      group: ['idCliente'],
      order: [[literal('m3'), 'DESC']],
      raw: true,
      nest: true,
    });
    const totalM3 = allClientes.reduce((s, r) => s + safe(r.m3), 0);
    let acumulado = 0;
    result.concentracion = allClientes.map(r => {
      const m3 = safe(r.m3);
      acumulado += m3;
      return {
        nombre: r.cliente?.razonSocial || `${r.cliente?.nombre || ''} ${r.cliente?.apellido || ''}`.trim(),
        m3: round2(m3),
        acumulado: pct(acumulado, totalM3),
      };
    });

    // Nuevos vs recurrentes
    if (start) {
      const clientesEnPeriodo = await db.Despacho.findAll({
        where,
        attributes: [[fn('DISTINCT', col('idCliente')), 'idCliente']],
        raw: true,
      });
      const clienteIds = clientesEnPeriodo.map(r => r.idCliente);

      if (clienteIds.length) {
        const clientesConHistoria = await db.Despacho.findAll({
          where: {
            idCliente: { [Op.in]: clienteIds },
            fecha: { [Op.lt]: start },
            activo: true,
          },
          attributes: [[fn('DISTINCT', col('idCliente')), 'idCliente']],
          raw: true,
        });
        const recurrentes = new Set(clientesConHistoria.map(r => r.idCliente));
        result.nuevosVsRecurrentes.recurrentes = recurrentes.size;
        result.nuevosVsRecurrentes.nuevos = clienteIds.length - recurrentes.size;
      }
    }

    // Estado de cuenta por cliente (solo facturas de hormigón, neto de NC)
    if (hormigonData?.allFacturaIds?.length) {
      const allIds = hormigonData.allFacturaIds;
      const estadoCuentaQuery = await db.sequelize.query(`
        SELECT
          f.idCliente,
          COALESCE(cl.razonSocial, CONCAT(COALESCE(cl.nombre,''), ' ', COALESCE(cl.apellido,''))) as nombre,
          SUM(CASE WHEN f.tipoComprobante LIKE '%CREDITO%' THEN -f.total ELSE f.total END) as facturado,
          COALESCE((
            SELECT SUM(c.importe) FROM Cobranza c
            WHERE c.idCliente = f.idCliente AND c.tipo = 'cobro'
              AND c.idFacturaVenta IN (:allIds)
          ), 0) as cobrado
        FROM FacturaVenta f
        LEFT JOIN Cliente cl ON f.idCliente = cl.idCliente
        WHERE f.idFacturaVenta IN (:allIds) AND f.estado != 'anulada'
        GROUP BY f.idCliente
        ORDER BY (SUM(CASE WHEN f.tipoComprobante LIKE '%CREDITO%' THEN -f.total ELSE f.total END) - COALESCE((
          SELECT SUM(c2.importe) FROM Cobranza c2
          WHERE c2.idCliente = f.idCliente AND c2.tipo = 'cobro'
            AND c2.idFacturaVenta IN (:allIds)
        ), 0)) DESC
        LIMIT 15
      `, { type: db.sequelize.QueryTypes.SELECT, replacements: { allIds } });

      result.estadoCuenta = estadoCuentaQuery.map(r => ({
        idCliente: r.idCliente,
        nombre: (r.nombre || '').trim(),
        facturado: round2(r.facturado),
        cobrado: round2(r.cobrado),
        saldo: round2(r.facturado - r.cobrado),
      }));
    }

  } catch (err) {
    console.error('[estadisticas] Clients error:', err.message);
  }

  return result;
}

/* ═══════════════════════════════════════
   Sección 6: Calidad
   ═══════════════════════════════════════ */
async function getQuality(db, where) {
  const result = {
    totalMuestras: 0, totalProbetas: 0, totalEnsayos: 0,
    tasaMuestreo: 0,
    resistenciaPromedio7d: null, resistenciaPromedio28d: null,
    cumplimiento28d: null,
    porTipoHormigon: [],
    pendientesRevision: 0,
  };

  try {
    // Total despachos y con muestra
    const despAgg = await db.Despacho.findOne({
      where,
      attributes: [
        [fn('COUNT', col('idDespacho')), 'total'],
        [fn('SUM', literal('CASE WHEN tieneMuestra = 1 THEN 1 ELSE 0 END')), 'conMuestra'],
      ],
      raw: true,
    });
    const totalDesp = safe(despAgg?.total);
    const conMuestra = safe(despAgg?.conMuestra);
    result.tasaMuestreo = pct(conMuestra, totalDesp);

    // Contar muestras, probetas, ensayos vinculados a despachos filtrados
    const muestrasIds = await db.Muestra.findAll({
      attributes: ['idMuestra'],
      include: [{ model: db.Despacho, as: 'despacho', attributes: [], where }],
      raw: true,
    });
    result.totalMuestras = muestrasIds.length;

    if (muestrasIds.length) {
      const mIds = muestrasIds.map(m => m.idMuestra);
      const probetasAgg = await db.Probeta.findOne({
        where: { idMuestra: { [Op.in]: mIds } },
        attributes: [[fn('COUNT', col('idProbeta')), 'total']],
        raw: true,
      });
      result.totalProbetas = safe(probetasAgg?.total);

      // Ensayos
      const ensayosAgg = await db.EnsayoResistencia.findOne({
        include: [{ model: db.Probeta, as: 'probeta', attributes: [], where: { idMuestra: { [Op.in]: mIds } } }],
        attributes: [[fn('COUNT', col('idEnsayoResistencia')), 'total']],
        raw: true,
      });
      result.totalEnsayos = safe(ensayosAgg?.total);

      // Resistencia promedio 7d y 28d
      const avg7 = await db.EnsayoResistencia.findOne({
        where: { edadEnsayo: 7 },
        include: [{ model: db.Probeta, as: 'probeta', attributes: [], where: { idMuestra: { [Op.in]: mIds } } }],
        attributes: [[fn('AVG', col('resistencia')), 'avg']],
        raw: true,
      });
      result.resistenciaPromedio7d = avg7?.avg != null ? round2(avg7.avg) : null;

      const avg28 = await db.EnsayoResistencia.findOne({
        where: { edadEnsayo: 28 },
        include: [{ model: db.Probeta, as: 'probeta', attributes: [], where: { idMuestra: { [Op.in]: mIds } } }],
        attributes: [[fn('AVG', col('resistencia')), 'avg']],
        raw: true,
      });
      result.resistenciaPromedio28d = avg28?.avg != null ? round2(avg28.avg) : null;

      // Cumplimiento 28d y por tipo hormigón
      const ensayos28d = await db.EnsayoResistencia.findAll({
        where: { edadEnsayo: 28 },
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

      if (ensayos28d.length) {
        let pass = 0;
        const byTipo = {};
        for (const e of ensayos28d) {
          const tipo = e.probeta?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon || 'N/A';
          const target = parseResistenciaTarget(tipo);
          const res = safe(e.resistencia);
          if (!byTipo[tipo]) byTipo[tipo] = { total: 0, pass: 0, sum: 0 };
          byTipo[tipo].total++;
          byTipo[tipo].sum += res;
          if (target && res >= target) {
            pass++;
            byTipo[tipo].pass++;
          }
        }
        result.cumplimiento28d = pct(pass, ensayos28d.length);

        result.porTipoHormigon = Object.entries(byTipo).map(([tipo, data]) => ({
          tipo,
          promedio28d: round2(data.sum / data.total),
          cumplimiento: pct(data.pass, data.total),
          ensayos: data.total,
        })).sort((a, b) => b.ensayos - a.ensayos);
      }

      // Pendientes de revisión
      const pendAgg = await db.EnsayoResistencia.findOne({
        where: { pendienteRevision: 1 },
        include: [{ model: db.Probeta, as: 'probeta', attributes: [], where: { idMuestra: { [Op.in]: mIds } } }],
        attributes: [[fn('COUNT', col('idEnsayoResistencia')), 'total']],
        raw: true,
      });
      result.pendientesRevision = safe(pendAgg?.total);
    }
  } catch (err) {
    console.error('[estadisticas] Quality error:', err.message);
  }

  return result;
}

/* ═══════════════════════════════════════
   Sección 7: Proyecciones y Tendencias
   ═══════════════════════════════════════ */
async function getProjections(db, where, start, end, hormigonData) {
  const result = {
    evolucionDiaria: [],
    evolucionMensual: [],
    facturacionMensual: [],
    comparacionAnual: { actual: [], anterior: [] },
    patronDiaSemana: [],
    estacionalidad: [],
  };

  try {
    // Evolución diaria
    result.evolucionDiaria = await db.Despacho.findAll({
      where,
      attributes: [
        ['fecha', 'fecha'],
        [fn('SUM', col('volumenDepacho')), 'volumen'],
        [fn('COUNT', col('idDespacho')), 'despachos'],
      ],
      group: ['fecha'],
      order: [['fecha', 'ASC']],
      raw: true,
    }).then(rows => rows.map(r => ({
      fecha: r.fecha,
      volumen: round2(r.volumen),
      despachos: safe(r.despachos),
    })));

    // Evolución mensual
    result.evolucionMensual = await db.Despacho.findAll({
      where,
      attributes: [
        [fn('DATE_FORMAT', col('fecha'), '%Y-%m'), 'mes'],
        [fn('SUM', col('volumenDepacho')), 'volumen'],
        [fn('COUNT', col('idDespacho')), 'despachos'],
      ],
      group: [literal("DATE_FORMAT(`fecha`, '%Y-%m')")],
      order: [[literal('mes'), 'ASC']],
      raw: true,
    }).then(rows => rows.map(r => ({
      mes: r.mes,
      volumen: round2(r.volumen),
      despachos: safe(r.despachos),
    })));

    // Facturación mensual (solo facturas de hormigón, neto de NC)
    if (hormigonData?.allFacturaIds?.length) {
      try {
        result.facturacionMensual = await db.sequelize.query(`
          SELECT DATE_FORMAT(f.fecha, '%Y-%m') as mes,
            SUM(CASE WHEN f.tipoComprobante LIKE '%CREDITO%' THEN -f.total ELSE f.total END) as total
          FROM FacturaVenta f
          WHERE f.idFacturaVenta IN (:allIds) AND f.estado != 'anulada'
          GROUP BY DATE_FORMAT(f.fecha, '%Y-%m')
          ORDER BY mes ASC
        `, { type: db.sequelize.QueryTypes.SELECT, replacements: { allIds: hormigonData.allFacturaIds } })
          .then(rows => rows.map(r => ({ mes: r.mes, total: safe(r.total) })));
      } catch { }
    }

    // Comparación año actual vs anterior
    const currentYear = new Date().getFullYear();
    const buildYearData = async (year) => {
      return db.Despacho.findAll({
        where: {
          activo: true,
          fecha: { [Op.gte]: `${year}-01-01`, [Op.lte]: `${year}-12-31` },
          ...(where.idPlanta ? { idPlanta: where.idPlanta } : {}),
        },
        attributes: [
          [fn('MONTH', col('fecha')), 'mes'],
          [fn('SUM', col('volumenDepacho')), 'volumen'],
        ],
        group: [literal("MONTH(`fecha`)")],
        order: [[literal('mes'), 'ASC']],
        raw: true,
      }).then(rows => rows.map(r => ({ mes: safe(r.mes), volumen: round2(r.volumen) })));
    };
    result.comparacionAnual.actual = await buildYearData(currentYear);
    result.comparacionAnual.anterior = await buildYearData(currentYear - 1);

    // Patrón día de semana
    const diasNombres = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    result.patronDiaSemana = await db.Despacho.findAll({
      where,
      attributes: [
        [fn('DAYOFWEEK', col('fecha')), 'dia'],
        [fn('AVG', col('volumenDepacho')), 'promedioVolumen'],
        [fn('COUNT', col('idDespacho')), 'totalDespachos'],
      ],
      group: [literal("DAYOFWEEK(`fecha`)")],
      order: [[literal('dia'), 'ASC']],
      raw: true,
    }).then(rows => rows.map(r => ({
      dia: safe(r.dia),
      nombre: diasNombres[safe(r.dia) - 1] || '?',
      promedioVolumen: round2(r.promedioVolumen),
      totalDespachos: safe(r.totalDespachos),
    })));

    // Estacionalidad (promedio mensual multi-año)
    result.estacionalidad = await db.Despacho.findAll({
      where: { activo: true, ...(where.idPlanta ? { idPlanta: where.idPlanta } : {}) },
      attributes: [
        [fn('MONTH', col('fecha')), 'mes'],
        [fn('AVG', col('volumenDepacho')), 'promedioVolumen'],
        [fn('SUM', col('volumenDepacho')), 'totalVolumen'],
        [fn('COUNT', col('idDespacho')), 'totalDespachos'],
        [fn('COUNT', literal('DISTINCT YEAR(`fecha`)')), 'anios'],
      ],
      group: [literal("MONTH(`fecha`)")],
      order: [[literal('mes'), 'ASC']],
      raw: true,
    }).then(rows => rows.map(r => ({
      mes: safe(r.mes),
      promedioVolumen: round2(r.promedioVolumen),
      volumenMensualPromedio: safe(r.anios) ? round2(safe(r.totalVolumen) / safe(r.anios)) : 0,
      totalDespachos: safe(r.totalDespachos),
    })));

  } catch (err) {
    console.error('[estadisticas] Projections error:', err.message);
  }

  return result;
}

/* ═══════════════════════════════════════
   Punto de entrada principal
   ═══════════════════════════════════════ */
exports.getEstadisticas = async (db, params = {}, user = {}) => {
  const { where, start, end, idTipoHormigon } = buildDespachoWhere(params, user);

  // Si hay filtro por tipo hormigón, lo incorporamos al where de forma especial
  // (se aplica en las queries que hacen join con Dosificacion)
  const whereWithTipo = idTipoHormigon ? { ...where, '$dosificacion.idTipoHormigon$': idTipoHormigon } : where;

  // Secciones solicitadas (todas por defecto)
  const requestedSections = params.sections
    ? params.sections.split(',').map(s => s.trim())
    : ['kpi', 'financial', 'operational', 'fleet', 'clients', 'quality', 'projections'];

  // Pre-computar datos financieros de hormigón (facturas vinculadas a despachos, neto de NC)
  const needsFinancial = ['kpi', 'financial', 'clients', 'projections'].some(s => requestedSections.includes(s));
  const hormigonData = needsFinancial ? await getHormigonFinancials(db, where) : null;

  const sections = {};
  const promises = [];

  if (requestedSections.includes('kpi')) {
    promises.push(getKpi(db, where, start, end, hormigonData).then(d => { sections.kpi = d; }));
  }
  if (requestedSections.includes('financial')) {
    promises.push(getFinancial(db, where, start, end, hormigonData).then(d => { sections.financial = d; }));
  }
  if (requestedSections.includes('operational')) {
    promises.push(getOperational(db, where).then(d => { sections.operational = d; }));
  }
  if (requestedSections.includes('fleet')) {
    promises.push(getFleet(db, where, start, end).then(d => { sections.fleet = d; }));
  }
  if (requestedSections.includes('clients')) {
    promises.push(getClients(db, where, start, end, hormigonData).then(d => { sections.clients = d; }));
  }
  if (requestedSections.includes('quality')) {
    promises.push(getQuality(db, where).then(d => { sections.quality = d; }));
  }
  if (requestedSections.includes('projections')) {
    promises.push(getProjections(db, where, start, end, hormigonData).then(d => { sections.projections = d; }));
  }

  await Promise.all(promises);

  return {
    meta: {
      periodo: {
        desde: start ? dayjs(start).format('YYYY-MM-DD') : null,
        hasta: end ? dayjs(end).format('YYYY-MM-DD') : null,
      },
      filtros: {
        idCliente: params.idCliente || null,
        idObra: params.idObra || null,
        idPlanta: params.idPlanta || null,
        idDosificacion: params.idDosificacion || null,
        idTipoHormigon: params.idTipoHormigon || null,
      },
    },
    ...sections,
  };
};
