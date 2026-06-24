const express = require('express');
const router = express.Router();
const agregadoController = require('../controllers/agregadoController');
const { verifyJwt } = require('../middlewares/verifyToken');

const ALT_TO_STD = { 4.8: 4.75, 2.4: 2.36, 1.2: 1.18, 12.5: 13.2, 25: 26.5, 50: 53, 13: 13.2 };

// Materiales para mezcla por planta
router.get('/planta/:plantaId/para-mezcla', verifyJwt, async (req, res) => {
  try {
    const plantaId = req.params.plantaId;
    const db = req.db;
    // para-mezcla request
    // Get all active aggregates for this plant
    const agregados = await db.Agregado.findAll({
      where: { idPlanta: plantaId, activo: true },
      raw: true,
    });

    // For each aggregate, get latest granulometry and density ensayos
    const result = [];
    for (const ag of agregados) {
      // Determine tipo from AgregadoFino/AgregadoGrueso tables
      const meta = await db.AgregadoMeta?.findOne({ where: { legacyAgregadoId: ag.idAgregado }, raw: true });
      let tipo = 'Grueso'; // default
      if (db.AgregadoFino) {
        const fino = await db.AgregadoFino.findOne({ where: { idAgregado: ag.idAgregado }, raw: true });
        if (fino) tipo = 'Fino';
      }
      if (tipo === 'Grueso' && db.AgregadoGrueso) {
        const grueso = await db.AgregadoGrueso.findOne({ where: { idAgregado: ag.idAgregado }, raw: true });
        if (!grueso && tipo === 'Grueso') {
          // Fallback: check granulometry tipoAgregado
          // Will be checked below after loading granulometry
        }
      }

      // Get latest granulometry COMPATIBLE WITH CONCRETE MIX DESIGN.
      //
      // Ignoramos ensayos con contextoAplicacion='TBS': esos suelen estar
      // cargados en serie TBS-DNV (tamices 31.5/16/13.2/6.3/3.35) y no cubren
      // la serie IRAM estándar que el motor de hormigón necesita (0.3/0.6/
      // 1.18/2.36/…). Si mezcláramos esas granulometrías al dosificar, no se
      // encuentran mezclas factibles aunque el agregado sí sea apto.
      //
      // contextoAplicacion es NOT NULL (default 'HORMIGON'), pero usamos IN
      // para ser explícitos sobre qué contextos aceptamos.
      const granEnsayo = await db.AgregadoEnsayo?.findOne({
        where: {
          legacyAgregadoId: ag.idAgregado,
          [db.Sequelize.Op.or]: [
            { contextoAplicacion: { [db.Sequelize.Op.in]: ['HORMIGON', 'AMBOS'] } },
            { contextoAplicacion: null }, // legacy rows en tenants sin migrar
          ],
        },
        include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo', where: { codigo: { [db.Sequelize.Op.like]: '%GRANULOMETRIA%' } } }],
        order: [['fechaEnsayo', 'DESC']],
      });

      if (!granEnsayo) continue; // Skip materials without concrete-compatible granulometry

      let resultado = granEnsayo.resultado;
      if (typeof resultado === 'string') try { resultado = JSON.parse(resultado); } catch { continue; }

      const tamices = resultado?.granulometria?.tamices;
      if (!tamices?.length) continue;

      // Build granulometry map
      const granulometria = {};
      for (const t of tamices) {
        if (t.pasaPct != null) {
          const ab = ALT_TO_STD[t.aberturaMm] ?? t.aberturaMm;
          granulometria[ab] = Number(t.pasaPct);
        }
      }

      // Override tipo from granulometry if available
      const granTipo = resultado?.granulometria?.tipoAgregado;
      if (granTipo) tipo = granTipo.charAt(0).toUpperCase() + granTipo.slice(1).toLowerCase();

      // Calculate MF from granulometry
      const tamicesMF = [0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5, 19, 37.5, 75];
      let sumRetAcum = 0;
      for (const tm of tamicesMF) {
        const pasa = granulometria[tm];
        if (pasa != null) sumRetAcum += (100 - pasa);
      }
      const mfCalc = Math.round(sumRetAcum) / 100;

      // Calculate TMN from granulometry (IRAM 1569: menor tamiz donde pasa >= 95%)
      const tamicesOrdenados = Object.keys(granulometria).map(Number).sort((a, b) => a - b);
      let tmnCalc = null;
      for (const tm of tamicesOrdenados) {
        if (granulometria[tm] >= 95) {
          tmnCalc = tm;
          break; // TMN = el MENOR tamiz donde pasa >= 95%
        }
      }

      // Get density from model or from density ensayo
      let densidad = ag.densidad ? (Number(ag.densidad) > 100 ? Number(ag.densidad) / 1000 : Number(ag.densidad)) : null;
      if (!densidad) {
        // Try to get from density ensayo (IRAM 1520 for fino, IRAM 1533 for grueso)
        try {
          const densCode = tipo === 'Fino' ? '%1520%' : '%1533%';
          const densEnsayo = await db.AgregadoEnsayo?.findOne({
            where: { legacyAgregadoId: ag.idAgregado },
            include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo', where: { codigo: { [db.Sequelize.Op.like]: densCode } } }],
            order: [['fechaEnsayo', 'DESC']],
          });
          if (densEnsayo) {
            let dr = densEnsayo.resultado;
            if (typeof dr === 'string') try { dr = JSON.parse(dr); } catch {}
            densidad = dr?.densidadRelativaAparenteSSS || dr?.densidadSSS || null;
          }
        } catch {}
      }

      result.push({
        id: ag.idAgregado,
        nombre: ag.nombre,
        tipo,
        subtipo: meta?.subtipoMaterial || null,
        mf: mfCalc || (ag.moduloFinura ? Number(ag.moduloFinura) : null),
        tmn: tmnCalc,
        densidadSSS: densidad,
        absorcion: ag.absorcion ? Number(ag.absorcion) : null,
        granulometria,
        fechaGranulometria: granEnsayo.fechaEnsayo,
      });
    }

    // ── Mezclas FINO/GRUESO guardadas como materiales disponibles ──
    try {
      if (db.MezclaAgregados) {
        const mezclas = await db.MezclaAgregados.findAll({
          where: {
            idPlanta: plantaId,
            tipoMezcla: { [db.Sequelize.Op.in]: ['FINO', 'GRUESO'] },
          },
          include: [{ model: db.MezclaAgregadosItem, as: 'items', include: [{ model: db.Agregado, as: 'agregado' }] }],
        });
        for (const mz of mezclas) {
          const plain = mz.get({ plain: true });
          // Parse curva combinada
          let curva = plain.curvaMezclaJson;
          if (typeof curva === 'string') try { curva = JSON.parse(curva); } catch { curva = null; }
          if (!Array.isArray(curva) || curva.length === 0) continue;

          // Build granulometry map
          const granulometria = {};
          for (const pt of curva) {
            if (pt.pasaPct != null) {
              const ab = ALT_TO_STD[pt.aberturaMm] ?? pt.aberturaMm;
              granulometria[ab] = Number(pt.pasaPct);
            }
          }
          if (Object.keys(granulometria).length < 3) continue;

          // MF
          const tamicesMF = [0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5, 19, 37.5, 75];
          let sumRetAcum = 0;
          for (const tm of tamicesMF) {
            const pasa = granulometria[tm];
            if (pasa != null) sumRetAcum += (100 - pasa);
          }
          const mfCalc = Math.round(sumRetAcum) / 100;

          // TMN
          const tamicesOrd = Object.keys(granulometria).map(Number).sort((a, b) => a - b);
          let tmnCalc = null;
          for (const tm of tamicesOrd) {
            if (granulometria[tm] >= 95) { tmnCalc = tm; break; }
          }

          // Densidad ponderada de componentes
          let densidadPond = null;
          let absorcionPond = null;
          if (plain.items?.length) {
            let sumDens = 0, sumAbs = 0, sumPct = 0;
            for (const it of plain.items) {
              const pct = it.porcentajeFinal || 0;
              const ag = result.find(r => r.id === it.idAgregado);
              if (ag?.densidadSSS && pct > 0) {
                sumDens += ag.densidadSSS * pct;
                sumAbs += (ag.absorcion || 0) * pct;
                sumPct += pct;
              }
            }
            if (sumPct > 0) {
              densidadPond = Math.round(sumDens / sumPct * 1000) / 1000;
              absorcionPond = Math.round(sumAbs / sumPct * 100) / 100;
            }
          }

          const tipoMz = plain.tipoMezcla === 'FINO' ? 'Fino' : 'Grueso';
          const compNames = (plain.items || []).map(it => it.agregado?.nombre || `Ag#${it.idAgregado}`).join(' + ');

          result.push({
            id: `mezcla_${plain.idMezcla}`,
            idMezcla: plain.idMezcla,
            nombre: `[Mezcla] ${plain.nombre || compNames}`,
            tipo: tipoMz,
            subtipo: 'mezcla_guardada',
            esMezcla: true,
            mf: mfCalc || (plain.moduloFinura ? Number(plain.moduloFinura) : null),
            tmn: tmnCalc || (plain.tmnCalculadoMm ? Number(plain.tmnCalculadoMm) : null),
            densidadSSS: densidadPond,
            absorcion: absorcionPond,
            granulometria,
            componentes: (plain.items || []).map(it => ({
              idAgregado: it.idAgregado,
              nombre: it.agregado?.nombre || null,
              porcentaje: it.porcentajeFinal,
            })),
          });
        }
      }
    } catch (err) {
      console.warn('[para-mezcla] Error cargando mezclas guardadas:', err.message);
    }

    // Get plant info for tolvas
    let cantidadTolvas = 4;
    try {
      const planta = await db.Planta.findByPk(plantaId, { raw: true });
      cantidadTolvas = planta?.cantidadTolvas || 4;
    } catch {}

    res.json({ plantaId, materiales: result, cantidadTolvas });
  } catch (err) {
    console.error('[materiales-para-mezcla]', err);
    res.status(500).json({ error: err.message });
  }
});

// Rutas CRUD unificadas
router.get('/', verifyJwt, agregadoController.getAgregados);
router.get('/:id', verifyJwt, agregadoController.getAgregado);
router.get('/:id/dosificaciones', verifyJwt, async (req, res) => {
  try {
    const { getDosificacionesVinculadas } = require('../services/agregadoService');
    const rows = await getDosificacionesVinculadas(req.db, req.params.id);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/', verifyJwt, agregadoController.createAgregado);
router.put('/:id', verifyJwt, agregadoController.updateAgregado);
router.delete('/:id', verifyJwt, agregadoController.deleteAgregado);

// IDA (Índice de Demanda de Agua)
router.post('/:id/ida/recalcular', verifyJwt, agregadoController.recalcularIda);
router.put('/:id/ida', verifyJwt, agregadoController.updateIda);

// Nueva ruta para obtener la lista de TamanioMaximoNominal
router.get('/tamaniosmaximos/all', verifyJwt, agregadoController.getTamaniosMaximos);

module.exports = router;
