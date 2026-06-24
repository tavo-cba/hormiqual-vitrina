'use strict';

const { calcularCorreccionHumedad } = require('../domain/dosificacion/correccionHumedad');

/**
 * Redondeo para cantidades por bachada:
 *  - > 100 kg → entero
 *  - ≤ 100 kg → un decimal
 */
const roundBachada = (val) => {
  if (val == null) return null;
  return Math.abs(val) > 100 ? Math.round(val) : Math.round(val * 10) / 10;
};

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Calcula la receta de obra completa a partir del resultado de dosificación,
 * humedades de agregados y volumen de bachada.
 *
 * @param {Object} resultado - resultado de dosificación (.aguaLtsM3, .agregados[], .cementoTotalKgM3, etc.)
 * @param {Object[]} humedades - [{idAgregado, nombre, absorcionPct, humedadPct, fuente?, ensayoId?}]
 * @param {number} volumenBachada - volumen de bachada en m³
 * @returns {{ correccion, cantidadesM3, cantidadesBachada, warnings }}
 */
function calcularRecetaObra(resultado, humedades, volumenBachada) {
  if (!resultado?.agregados?.length) throw new Error('Sin datos de agregados en el resultado');
  if (!humedades?.length) throw new Error('Debe ingresar al menos una humedad');
  if (!volumenBachada || volumenBachada <= 0) throw new Error('Volumen de bachada inválido');

  const warnings = [];

  // Validate inputs
  for (const h of humedades) {
    if (h.humedadPct == null) continue;
    if (h.humedadPct < 0) throw new Error(`La humedad no puede ser negativa (${h.nombre})`);
    if (h.absorcionPct == null || h.absorcionPct === 0) {
      throw new Error(`Falta absorción para ${h.nombre}. Cargar en catálogo.`);
    }
    // Warnings for unusually high humidity
    const isGrueso = (h.tipoAgregado || '').toUpperCase().includes('GRUESO');
    const umbral = isGrueso ? 8 : 15;
    if (h.humedadPct > umbral) {
      warnings.push({ tipo: 'HUMEDAD_ALTA', mensaje: `${h.nombre}: humedad ${h.humedadPct}% inusualmente alta (umbral ${umbral}%)` });
    }
  }

  // All zeros check
  const allZero = humedades.every(h => !h.humedadPct || h.humedadPct === 0);
  if (allZero) {
    warnings.push({ tipo: 'SIN_CORRECCION', mensaje: 'Todas las humedades son cero. Sin corrección significativa.' });
  }

  // Use existing engine for per-m³ correction
  const humedadInputs = humedades.map(h => ({ idAgregado: h.idAgregado, humedadPct: h.humedadPct }));
  const corr = calcularCorreccionHumedad(resultado, humedadInputs);
  if (!corr) throw new Error('No se pudo calcular la corrección por humedad');

  const { recetaObra, correccionDetalle } = corr;

  // Validate agua corregida
  if (recetaObra.aguaLtsM3 < 0) {
    throw new Error('Los agregados aportan más agua que la necesaria. Verificar humedades.');
  }
  if (recetaObra.aguaLtsM3 < 50) {
    warnings.push({ tipo: 'AGUA_BAJA', mensaje: `Agua corregida (${recetaObra.aguaLtsM3} L/m³) inusualmente baja. Verificar humedades.` });
  }
  const diff = Math.abs(correccionDetalle.deltaAguaTotal);
  if (diff < 1) {
    warnings.push({ tipo: 'SSS_APROX', mensaje: 'Agregados prácticamente en condición SSS.' });
  }

  // Build cantidades_m3 (corrected per m³)
  const cantidadesM3 = {
    agua: round1(recetaObra.aguaLtsM3),
    cemento: round1(recetaObra.cementoKgM3),
    adicion1: recetaObra.adicion1KgM3 ? round1(recetaObra.adicion1KgM3) : null,
    adicion2: recetaObra.adicion2KgM3 ? round1(recetaObra.adicion2KgM3) : null,
    aditivos: (recetaObra.aditivos || []).map(a => ({
      label: a.label || a.nombre,
      kgM3: a.kgM3 != null ? round2(a.kgM3) : null,
      dosis: a.dosis,
      unidad: a.unidad,
    })),
    agregados: recetaObra.agregados.map(a => ({
      nombre: a.nombre,
      idAgregado: a.idAgregado,
      kgM3: round1(a.kgM3),
      condicion: a.condicion,
    })),
    airePct: recetaObra.airePct,
    puvObra: recetaObra.puvObra,
  };

  // Build cantidades_bachada
  const vol = Number(volumenBachada);
  const cantidadesBachada = {
    volumenM3: vol,
    agua: roundBachada(cantidadesM3.agua * vol),
    cemento: roundBachada(cantidadesM3.cemento * vol),
    adicion1: cantidadesM3.adicion1 ? roundBachada(cantidadesM3.adicion1 * vol) : null,
    adicion2: cantidadesM3.adicion2 ? roundBachada(cantidadesM3.adicion2 * vol) : null,
    aditivos: cantidadesM3.aditivos.map(a => ({
      label: a.label,
      cantidad: a.kgM3 != null ? roundBachada(a.kgM3 * vol) : null,
      unidad: a.kgM3 != null ? 'kg' : a.unidad,
    })),
    agregados: cantidadesM3.agregados.map(a => ({
      nombre: a.nombre,
      idAgregado: a.idAgregado,
      cantidad: roundBachada(a.kgM3 * vol),
    })),
  };

  return {
    correccion: correccionDetalle,
    cantidadesM3,
    cantidadesBachada,
    warnings,
  };
}

// ═══════════════════════════════════════
// CRUD operations
// ═══════════════════════════════════════

/**
 * Guardar una receta de obra.
 */
const guardarReceta = async (db, data) => {
  const {
    dosificacionDisenadaId,
    volumenBachada,
    humedades,
    resultado,
    fechaMedicion,
    medidoPor,
    observaciones,
    creadoPor,
  } = data;

  if (!dosificacionDisenadaId) throw new Error('Falta dosificacionDisenadaId');
  if (!resultado) throw new Error('Falta resultado de dosificación');

  // Verify dosificación exists and check state
  const dosif = await db.DosificacionDisenada.findByPk(dosificacionDisenadaId);
  if (!dosif) throw new Error('Dosificación no encontrada');

  const estadosPermitidos = ['BORRADOR', 'A_PRUEBA', 'APROBADO', 'EN_PRODUCCION'];
  if (!estadosPermitidos.includes(dosif.estado)) {
    throw new Error(`No se pueden crear recetas en estado ${dosif.estado}`);
  }

  // Calculate
  const calc = calcularRecetaObra(resultado, humedades, volumenBachada);

  const receta = await db.RecetaObra.create({
    dosificacionDisenadaId,
    volumenBachada,
    humedadesJson: humedades,
    aguaTeorica: resultado.aguaLtsM3,
    aguaCorregida: calc.cantidadesM3.agua,
    correccionTotal: calc.correccion.deltaAguaTotal,
    cantidadesM3Json: calc.cantidadesM3,
    cantidadesBachadaJson: calc.cantidadesBachada,
    fechaMedicion: fechaMedicion || new Date().toISOString().split('T')[0],
    medidoPor: medidoPor || null,
    observaciones: observaciones || null,
    creadoPor: creadoPor || 'sistema',
  });

  return { receta, warnings: calc.warnings };
};

/**
 * Listar recetas de una dosificación.
 */
const listarRecetas = async (db, dosificacionDisenadaId) => {
  const rows = await db.RecetaObra.findAll({
    where: { dosificacionDisenadaId },
    order: [['fechaMedicion', 'DESC'], ['createdAt', 'DESC']],
  });
  return rows;
};

/**
 * Obtener una receta por ID.
 */
const obtenerReceta = async (db, id) => {
  const receta = await db.RecetaObra.findByPk(id);
  if (!receta) throw new Error('Receta no encontrada');
  return receta;
};

/**
 * Eliminar receta.
 */
const eliminarReceta = async (db, id) => {
  const receta = await db.RecetaObra.findByPk(id);
  if (!receta) throw new Error('Receta no encontrada');
  await receta.destroy();
  return { ok: true };
};

/**
 * Obtener últimas humedades de ensayo para los agregados de una dosificación.
 */
const obtenerUltimasHumedadesEnsayo = async (db, dosificacionDisenadaId) => {
  const dosif = await db.DosificacionDisenada.findByPk(dosificacionDisenadaId);
  if (!dosif) throw new Error('Dosificación no encontrada');

  const resultadoJson = typeof dosif.resultadoJson === 'string'
    ? JSON.parse(dosif.resultadoJson)
    : dosif.resultadoJson;

  if (!resultadoJson?.agregados?.length) return [];

  const humedadCodes = ['IRAM1627_HUMEDAD', 'IRAM1627_CONTENIDO_HUMEDAD'];

  const result = [];
  for (const ag of resultadoJson.agregados) {
    const idAg = ag.idAgregado || ag.id;
    if (!idAg) continue;

    // Find latest humidity ensayo for this aggregate
    let ensayo = null;
    if (db.AgregadoEnsayo && db.AgregadoEnsayoTipo) {
      try {
        ensayo = await db.AgregadoEnsayo.findOne({
          where: { legacyAgregadoId: idAg, isActive: true },
          include: [{
            model: db.AgregadoEnsayoTipo,
            as: 'tipo',
            where: { codigo: humedadCodes },
            required: true,
          }],
          order: [['fechaEnsayo', 'DESC'], ['createdAt', 'DESC']],
        });
      } catch { /* ensayo tables might not exist */ }
    }

    let humedadPct = null;
    let fechaEnsayo = null;
    let ensayoId = null;

    if (ensayo) {
      const raw = ensayo.resultadoJson;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      humedadPct = r?.humedadPct ?? r?.contenidoHumedad ?? null;
      fechaEnsayo = ensayo.fechaEnsayo;
      ensayoId = ensayo.idAgregadoEnsayo;
    }

    result.push({
      idAgregado: idAg,
      nombre: ag.nombre,
      absorcionPct: ag.absorcionPct,
      humedadPct,
      fechaEnsayo,
      ensayoId,
      fuente: ensayo ? 'ensayo' : null,
    });
  }

  return result;
};

module.exports = {
  calcularRecetaObra,
  guardarReceta,
  listarRecetas,
  obtenerReceta,
  eliminarReceta,
  obtenerUltimasHumedadesEnsayo,
};
