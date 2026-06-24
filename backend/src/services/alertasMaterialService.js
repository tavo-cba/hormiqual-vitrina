'use strict';

/**
 * alertasMaterialService.js
 *
 * Generates alerts for dosifications when component materials change.
 * Called after saving ensayos to check if any active dosification is affected.
 *
 * PR9.4 — POLÍTICA DE MODO: este service opera en modo PRESCRIPTIVO. Todo
 * cambio de ensayo en un material dispara alerta sobre las dosificaciones
 * afectadas, INDEPENDIENTEMENTE del flag de obligatoriedad del catálogo del
 * tenant. La razón: una alerta es un AVISO de cambio que requiere atención
 * técnica; si el tecnólogo decidió que el ensayo no es obligatorio para sus
 * certificaciones, el operador puede descartarla, pero el sistema no debe
 * silenciar ese aviso por anticipado. El catálogo del tenant decide qué se
 * EVALÚA, no qué se MONITOREA.
 *
 * Auditoría 02-dosificación D6: la decisión de nivel/recálculo es propia del
 * dominio de alertas (UX) y no la cubre la matriz prescriptiva. Sí se enriquece
 * el mensaje con la `cita`/`normaRef` desde la SSoT (`matrizPrescriptiva`)
 * cuando el código del ensayo está consolidado, así no se duplican strings.
 */

const { metadataExigibilidad } = require('../domain/normativa/matrizPrescriptiva');

/**
 * Citas de pseudo-códigos derivados (sumas calculadas en
 * `aptitudMaterialesEngine`). No son ensayos individuales y por eso no viven
 * en la matriz prescriptiva (`obtenerEnsayosExigibles` no debería listarlos).
 * Se mantienen acá para que las alertas puedan resolver su cita normativa.
 */
const CITAS_PSEUDO_CODIGOS = Object.freeze({
  _SUMA_NOCIVAS_AF: Object.freeze({
    nombre: 'Suma de sustancias nocivas (agregado fino)',
    normaRef: 'IRAM 1512',
    cita: 'IRAM 1512 §5.2.2 — suma ≤ 5,0% (con desgaste) / ≤ 7,0% (sin desgaste)',
  }),
  _SUMA_NOCIVAS_AG: Object.freeze({
    nombre: 'Suma de sustancias nocivas (agregado grueso)',
    normaRef: 'IRAM 1531',
    cita: 'IRAM 1531 §5.1.2.2 — suma ≤ 5,0%',
  }),
});

/**
 * Resuelve nombre y referencia normativa desde la SSoT consolidada (matriz
 * prescriptiva) o, si el código es un pseudo-código derivado, desde el mapa
 * local. El segundo argumento (contexto) es opcional — la metadata genérica
 * del código se obtiene aún sin contexto puntual.
 */
function _normaInfo(tipoEnsayoCodigo, contexto = null) {
  if (!tipoEnsayoCodigo) return null;
  const pseudo = CITAS_PSEUDO_CODIGOS[tipoEnsayoCodigo];
  if (pseudo) return { ...pseudo };
  try {
    const meta = metadataExigibilidad(tipoEnsayoCodigo, contexto || {});
    if (!meta) return null;
    return {
      nombre: meta.nombre || null,
      normaRef: meta.normaRef || null,
      cita: meta.cita || null,
    };
  } catch {
    return null;
  }
}

/**
 * Evaluate the impact of a new ensayo on dosifications.
 *
 * @param {string} tipoEnsayoCodigo — código canónico del ensayo.
 * @param {object} [contexto] — opcional, contexto de la dosificación afectada
 *   (claseExposicion, fceMpa, etc.). Se usa para enriquecer el mensaje desde
 *   la SSoT prescriptiva cuando aplique.
 */
function evaluarImpacto(tipoEnsayoCodigo, contexto = null) {
  const cod = (tipoEnsayoCodigo || '').toUpperCase();
  const info = _normaInfo(tipoEnsayoCodigo, contexto);
  // Cuando la SSoT conoce el código, agregamos la cita al final del mensaje
  // para que el operador vea la fuente normativa.
  const sufijoNorma = info?.normaRef ? ` (Ref.: ${info.normaRef})` : '';

  if (cod.includes('GRANULOMETRIA') || cod.includes('1505')) {
    return {
      nivel: 'critico',
      mensaje: `La granulometria del material ha cambiado. Los indicadores de trabajabilidad (Shilstone, FdA), el agua de amasado y las proporciones de la dosificacion pueden estar desactualizados.${sufijoNorma}`,
      requiereRecalculo: true,
    };
  }
  if (cod.includes('DENSIDAD') || cod.includes('1520') || cod.includes('1533')) {
    return {
      nivel: 'alto',
      mensaje: `La densidad del material ha cambiado. Los kg/m3 de la dosificacion deben recalcularse.${sufijoNorma}`,
      requiereRecalculo: true,
    };
  }
  if (cod.includes('ABSORCION') || cod.includes('1548') || cod.includes('PESO_UNITARIO')) {
    return {
      nivel: 'medio',
      mensaje: `La absorcion o peso unitario del material ha cambiado. Verificar la correccion por humedad.${sufijoNorma}`,
      requiereRecalculo: false,
    };
  }
  if (cod.includes('CLORURO') || cod.includes('1882')) {
    return { nivel: 'medio', mensaje: `Nuevo resultado de cloruros. Verificar cumplimiento normativo.${sufijoNorma}`, requiereRecalculo: false };
  }
  if (cod.includes('SULFATO') || cod.includes('SALES') || cod.includes('TERRONES') || cod.includes('CARBONOS')) {
    return { nivel: 'medio', mensaje: `Nuevo ensayo quimico. Verificar cumplimiento normativo del material.${sufijoNorma}`, requiereRecalculo: false };
  }
  return { nivel: 'bajo', mensaje: `Nuevo ensayo registrado. Revisar si afecta la dosificacion.${sufijoNorma}`, requiereRecalculo: false };
}

/**
 * Find dosifications that use a specific aggregate and generate alerts.
 * Called after saving/updating an ensayo.
 *
 * @param {object} db - Sequelize database instance
 * @param {number} idAgregado - The aggregate ID that changed
 * @param {string} tipoEnsayoCodigo - The ensayo type code (e.g. 'IRAM1505_GRANULOMETRIA')
 * @param {string} nombreEnsayo - Human-readable ensayo name
 * @param {string} nombreMaterial - Human-readable material name
 */
async function generarAlertasPorCambioMaterial(db, idAgregado, tipoEnsayoCodigo, nombreEnsayo, nombreMaterial) {
  if (!db.AlertaDosificacion) return;

  try {
    // Find dosifications that use this aggregate (via mezcla items)
    const [dosifs] = await db.sequelize.query(`
      SELECT DISTINCT d.id, d.nombre, d.estado
      FROM DosificacionDisenada d
      JOIN MezclaAgregados m ON d.idMezcla = m.idMezcla
      JOIN MezclaAgregadosItem mi ON m.idMezcla = mi.idMezcla
      WHERE mi.idAgregado = ?
        AND d.estado IN ('BORRADOR', 'A_PRUEBA', 'PENDIENTE_REVISION', 'APROBADO')
    `, { replacements: [idAgregado] });

    if (!dosifs.length) return;

    const impacto = evaluarImpacto(tipoEnsayoCodigo);

    for (const dos of dosifs) {
      // Check if there's already a pending alert for this dosification + material + ensayo type
      const existing = await db.AlertaDosificacion.findOne({
        where: {
          idDosificacion: dos.id,
          idMaterial: idAgregado,
          tipoEnsayo: tipoEnsayoCodigo,
          estado: 'PENDIENTE',
        },
      });

      if (existing) {
        // Update existing alert
        await existing.update({
          mensaje: impacto.mensaje,
          nivel: impacto.nivel,
          requiereRecalculo: impacto.requiereRecalculo,
          nombreEnsayo: nombreEnsayo || existing.nombreEnsayo,
        });
      } else {
        // Create new alert
        await db.AlertaDosificacion.create({
          idDosificacion: dos.id,
          idMaterial: idAgregado,
          nombreMaterial: nombreMaterial || null,
          tipoEnsayo: tipoEnsayoCodigo,
          nombreEnsayo: nombreEnsayo || null,
          nivel: impacto.nivel,
          mensaje: impacto.mensaje,
          requiereRecalculo: impacto.requiereRecalculo,
          estado: 'PENDIENTE',
        });
      }
    }

    console.log(`[alertas] ${dosifs.length} dosificacion(es) alertadas por cambio en material ${idAgregado} (${tipoEnsayoCodigo})`);
  } catch (err) {
    console.warn('[alertas] Error generando alertas:', err.message);
  }
}

/**
 * Get pending alerts for a dosification
 */
async function obtenerAlertasDosificacion(db, idDosificacion) {
  if (!db.AlertaDosificacion) return [];
  return db.AlertaDosificacion.findAll({
    where: { idDosificacion, estado: 'PENDIENTE' },
    order: [['nivel', 'ASC'], ['createdAt', 'DESC']],
    raw: true,
  });
}

/**
 * Resolve an alert
 */
async function resolverAlerta(db, alertaId, { estado, usuario, notas } = {}) {
  if (!db.AlertaDosificacion) return null;
  const alerta = await db.AlertaDosificacion.findByPk(alertaId);
  if (!alerta) return null;

  // Snapshot pre-update para auditar el estado anterior de la alerta.
  const previo = alerta.get({ plain: true });

  await alerta.update({
    estado: estado || 'RESUELTA',
    resueltaPor: usuario || null,
    fechaResolucion: new Date(),
    notasResolucion: notas || null,
  });

  // Fase 4.1 — registrar evento de auditoría sobre la dosificación afectada.
  // Solo si la alerta apunta a una dosificación (idDosificacion). Fail-soft.
  if (previo.idDosificacion) {
    try {
      const { logEventoDosificacion } = require('./auditDosificacionService');
      const { TIPO_EVENTO } = require('../domain/dosificacion/historialEventos');
      await logEventoDosificacion(db, {
        entidadId: previo.idDosificacion,
        tipoEvento: TIPO_EVENTO.ALERTA_RESUELTA,
        usuario: usuario || 'sistema',
        motivo: notas || null,
        observaciones: `Alerta #${alertaId} marcada como ${estado || 'RESUELTA'}`,
        metadata: {
          alertaId,
          estadoAlertaAnterior: previo.estado,
          estadoAlertaNuevo: estado || 'RESUELTA',
          nivel: previo.nivel || null,
          tipoEnsayo: previo.tipoEnsayo || null,
          idMaterial: previo.idMaterial || null,
          requiereRecalculo: previo.requiereRecalculo || false,
        },
      });
    } catch (e) {
      console.warn('[resolverAlerta] Error logging audit event:', e.message);
    }
  }

  return alerta;
}

/**
 * Generate alerts for mezclas that use a changed material.
 * Stores a lightweight flag in MezclaAgregados.metadataResultadoJson so the
 * frontend can show a banner like "Granulometría de [material] actualizada desde
 * que se diseñó esta mezcla. Considerar re-evaluar."
 */
async function generarAlertasMezclaPorCambioMaterial(db, idAgregado, tipoEnsayoCodigo, nombreMaterial) {
  try {
    if (!db.MezclaAgregados || !db.MezclaAgregadosItem) return;

    // Only relevant for granulometry-impacting tests
    const TIPOS_RELEVANTES = ['IRAM_1627', 'GRANULOMETRIA', 'ASTM_C136', 'ASTM_C33', 'IRAM_1505', 'IRAM_1520', 'IRAM_1533'];
    const esRelevante = TIPOS_RELEVANTES.some(t => (tipoEnsayoCodigo || '').toUpperCase().includes(t.replace('IRAM_', '').replace('ASTM_', '')));
    if (!esRelevante && !(tipoEnsayoCodigo || '').toLowerCase().includes('granulom')) return;

    const mezclas = await db.MezclaAgregadosItem.findAll({
      where: { idAgregado },
      attributes: ['idMezcla'],
      raw: true,
    });
    if (!mezclas.length) return;

    const ids = [...new Set(mezclas.map(m => m.idMezcla))];
    for (const idMezcla of ids) {
      const mezcla = await db.MezclaAgregados.findByPk(idMezcla);
      if (!mezcla || !['BORRADOR', 'A_PRUEBA', 'PENDIENTE_REVISION', 'APROBADO'].includes(mezcla.estado)) continue;

      // Append alert to metadataResultadoJson
      let meta = mezcla.metadataResultadoJson;
      if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
      if (!meta) meta = {};
      if (!meta._alertas) meta._alertas = [];

      // Avoid duplicate alerts for same material + ensayo type
      const yaExiste = meta._alertas.some(a => a.idAgregado === idAgregado && a.tipo === tipoEnsayoCodigo && a.estado === 'PENDIENTE');
      if (yaExiste) continue;

      meta._alertas.push({
        idAgregado,
        nombreMaterial: nombreMaterial || null,
        tipo: tipoEnsayoCodigo,
        fecha: new Date().toISOString(),
        mensaje: `Ensayo de ${nombreMaterial || 'agregado'} actualizado. Considerar re-evaluar la mezcla.`,
        estado: 'PENDIENTE',
      });

      await mezcla.update({ metadataResultadoJson: JSON.stringify(meta) });
    }
    console.log(`[alertas-mezcla] ${ids.length} mezcla(s) alertadas por cambio en material ${idAgregado}`);
  } catch (err) {
    console.warn('[alertas-mezcla] Error:', err.message);
  }
}

module.exports = { generarAlertasPorCambioMaterial, generarAlertasMezclaPorCambioMaterial, evaluarImpacto, obtenerAlertasDosificacion, resolverAlerta };
