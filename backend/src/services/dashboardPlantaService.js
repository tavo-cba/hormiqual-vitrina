'use strict';

/**
 * dashboardPlantaService.js
 *
 * Servicio de dashboard de planta: indicadores resumidos de materiales,
 * mezclas, dosificaciones y alertas para una planta específica.
 */

const getDashboard = async (db, idPlanta) => {
  if (!idPlanta) throw new Error('idPlanta es requerido');

  const results = {};

  // ── Materiales (Agregados) ──
  try {
    const agregados = await db.Agregado.findAll({
      where: { idPlanta, activo: true },
      attributes: ['idAgregado', 'nombre', 'tipo'],
      raw: true,
    });
    const finos = agregados.filter(a => (a.tipo || '').toLowerCase().includes('fino'));
    const gruesos = agregados.filter(a => !((a.tipo || '').toLowerCase().includes('fino')));
    results.materiales = {
      total: agregados.length,
      finos: finos.length,
      gruesos: gruesos.length,
    };
  } catch { results.materiales = { total: 0, finos: 0, gruesos: 0 }; }

  // ── Cementos habilitados para la planta ──
  // Pivote `CementoPlanta` (idCemento × idPlanta + activo). Cuenta cementos
  // efectivamente disponibles en esta planta, no el catálogo global del tenant.
  try {
    if (db.CementoPlanta) {
      const cementos = await db.CementoPlanta.count({
        where: { idPlanta, activo: true },
      });
      results.cementos = cementos;
    } else {
      results.cementos = 0;
    }
  } catch (err) {
    console.warn('[dashboardPlanta] cementos:', err.message);
    results.cementos = 0;
  }

  // ── Mezclas por estado ──
  try {
    if (db.MezclaAgregados) {
      const mezclas = await db.MezclaAgregados.findAll({
        where: { idPlanta, isActive: true },
        attributes: ['idMezcla', 'nombre', 'estado', 'tipoMezcla', 'tmnCalculadoMm', 'moduloFinura', 'updatedAt'],
        order: [['updatedAt', 'DESC']],
        raw: true,
      });
      const porEstado = {};
      for (const m of mezclas) {
        porEstado[m.estado] = (porEstado[m.estado] || 0) + 1;
      }
      results.mezclas = {
        total: mezclas.length,
        porEstado,
        aprobadas: porEstado.APROBADO || 0,
        recientes: mezclas.slice(0, 5).map(m => ({
          id: m.idMezcla, nombre: m.nombre, estado: m.estado,
          tipo: m.tipoMezcla, tmn: m.tmnCalculadoMm, mf: m.moduloFinura,
          fecha: m.updatedAt,
        })),
      };
    } else {
      results.mezclas = { total: 0, porEstado: {}, aprobadas: 0, recientes: [] };
    }
  } catch { results.mezclas = { total: 0, porEstado: {}, aprobadas: 0, recientes: [] }; }

  // ── Dosificaciones por estado ──
  try {
    if (db.DosificacionDisenada) {
      const dosifs = await db.DosificacionDisenada.findAll({
        where: { idPlanta },
        attributes: ['id', 'nombre', 'estado', 'version', 'updatedAt'],
        order: [['updatedAt', 'DESC']],
        raw: true,
      });
      const porEstado = {};
      for (const d of dosifs) {
        porEstado[d.estado] = (porEstado[d.estado] || 0) + 1;
      }
      results.dosificaciones = {
        total: dosifs.length,
        porEstado,
        aprobadas: porEstado.APROBADO || 0,
        recientes: dosifs.slice(0, 5).map(d => ({
          id: d.id, nombre: d.nombre, estado: d.estado,
          version: d.version, fecha: d.updatedAt,
        })),
      };
    } else {
      results.dosificaciones = { total: 0, porEstado: {}, aprobadas: 0, recientes: [] };
    }
  } catch { results.dosificaciones = { total: 0, porEstado: {}, aprobadas: 0, recientes: [] }; }

  // ── Alertas pendientes (filtradas por planta) ──
  // `AlertaDosificacion` no tiene `idPlanta` ni asociación declarada con
  // `DosificacionDisenada`. Se filtra en dos pasos: IDs de dosificaciones de
  // la planta + lookup por `idDosificacion IN (...)`. Sin esto, el dashboard
  // mostraba alertas de TODO el tenant aunque el usuario eligió una planta.
  try {
    if (db.AlertaDosificacion && db.DosificacionDisenada) {
      const dosifIds = (await db.DosificacionDisenada.findAll({
        where: { idPlanta },
        attributes: ['id'],
        raw: true,
      })).map(r => r.id);

      if (dosifIds.length === 0) {
        results.alertas = { total: 0, items: [] };
      } else {
        const alertas = await db.AlertaDosificacion.findAll({
          where: { estado: 'PENDIENTE', idDosificacion: dosifIds },
          attributes: ['id', 'nivel', 'mensaje', 'nombreMaterial', 'tipoEnsayo', 'createdAt'],
          order: [['nivel', 'ASC'], ['createdAt', 'DESC']],
          limit: 20,
          raw: true,
        });
        results.alertas = {
          total: alertas.length,
          items: alertas.slice(0, 10),
        };
      }
    } else {
      results.alertas = { total: 0, items: [] };
    }
  } catch (err) {
    console.warn('[dashboardPlanta] alertas:', err.message);
    results.alertas = { total: 0, items: [] };
  }

  // Sección "ensayosRecientes" eliminada (sesión 2026-05-09): código muerto
  // sin consumers en frontend ni backend, además no filtraba por idPlanta.
  // Si en el futuro se necesita exponer ensayos recientes, debe filtrar via
  // include con `Agregado.idPlanta`.

  return results;
};

module.exports = { getDashboard };
