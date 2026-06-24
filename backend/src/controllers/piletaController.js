const piletaService = require('../services/piletaService');

const getPiletas = async (req, res) => {
    try {
        const piletas = await piletaService.getPiletas(req.db);
        res.status(200).json(piletas);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener piletas' });
    }
};

const getPileta = async (req, res) => {
    try {
        const pileta = await piletaService.getPileta(req.db, req.params.id);
        if (!pileta) return res.status(404).json({ error: 'Pileta no encontrada' });
        res.status(200).json(pileta);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener la pileta' });
    }
};

const getPiletasByPlanta = async (req, res) => {
    try {
        const piletas = await piletaService.getPiletasByPlanta(req.db, req.params.idPlanta);
        res.status(200).json(piletas);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener piletas de la planta' });
    }
};

const createPileta = async (req, res) => {
    try {
        const nueva = await piletaService.createPileta(req.db, req.body);
        res.status(201).json(nueva);
    } catch (error) {
        console.error(error);
        const msg = error.name === 'SequelizeUniqueConstraintError'
            ? 'Ya existe una pileta con ese hashId'
            : 'Error al crear la pileta';
        res.status(500).json({ error: msg });
    }
};

const updatePileta = async (req, res) => {
    try {
        const updated = await piletaService.updatePileta(req.db, req.params.id, req.body);
        res.status(200).json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar la pileta' });
    }
};

const deletePileta = async (req, res) => {
    try {
        await piletaService.deletePileta(req.db, req.params.id);
        res.status(200).json({ message: 'Pileta eliminada correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar la pileta' });
    }
};

const bulkAssignLab = async (req, res) => {
    try {
        const result = await piletaService.bulkAssignLab(req.db, {
            idLaboratorio: req.body?.idLaboratorio,
            idsPileta: req.body?.idsPileta || req.body?.piletas,
        });
        res.status(200).json(result);
    } catch (error) {
        const status = error?.status || 500;
        if (status === 500) console.error(error);
        res.status(status).json({ error: error?.message || 'Error en la asignación masiva' });
    }
};

const recibirReporteLaboratorio = async (req, res) => {
    try {
        const results = await piletaService.procesarReporteLaboratorio(req.db, req.body);
        res.status(200).json({ success: true, results });
    } catch (error) {
        console.error('Error procesando reporte lab:', error);
        res.status(500).json({ error: 'Error al procesar reporte del laboratorio' });
    }
};

const getAlertas = async (req, res) => {
    try {
        const alertas = await piletaService.getAlertas(req.db);
        res.status(200).json(alertas);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener alertas' });
    }
};

const getTemperatureHistory = async (req, res) => {
    try {
        const { desde, hasta } = req.query;
        const data = await piletaService.getTemperatureHistory(req.db, req.params.id, desde, hasta);
        res.status(200).json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener historial de temperatura' });
    }
};

// ---- Consumo eléctrico ----

const getConsumo = async (req, res) => {
    try {
        const { desde, hasta } = req.query;
        const data = await piletaService.getConsumo(req.db, req.params.id, desde, hasta);
        res.status(200).json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al calcular consumo' });
    }
};

const getCorrelacionAmbiente = async (req, res) => {
    try {
        const { desde, hasta } = req.query;
        const data = await piletaService.getCorrelacionAmbiente(req.db, req.params.id, desde, hasta);
        res.status(200).json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al calcular correlación con ambiente' });
    }
};

const getResistenciasOnRanges = async (req, res) => {
    try {
        const { desde, hasta } = req.query;
        const data = await piletaService.getResistenciasOnRanges(req.db, req.params.id, desde, hasta);
        res.status(200).json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener rangos de resistencias' });
    }
};

// ---- Cola de comandos (desde Hormiqual al lab) ----

const crearComando = async (req, res) => {
    try {
        const { tipo, payload } = req.body;
        if (!tipo) return res.status(400).json({ error: 'tipo es requerido' });
        const comando = await piletaService.crearComando(req.db, req.params.id, tipo, payload);
        res.status(201).json(comando);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear comando' });
    }
};

const getComandosRecientes = async (req, res) => {
    try {
        const comandos = await piletaService.getComandosRecientes(req.db, req.params.id);
        res.status(200).json(comandos);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener comandos' });
    }
};

// Endpoint que pollea el lab: GET /api/laboratorio/comandos?hashIds=uuid1,uuid2
const getComandosPendientes = async (req, res) => {
    try {
        const { hashIds } = req.query;
        if (!hashIds) return res.status(400).json({ error: 'hashIds requerido' });
        const ids = hashIds.split(',').map(s => s.trim()).filter(Boolean);
        const comandos = await piletaService.getComandosPendientesPorHashIds(req.db, ids);
        res.status(200).json({ success: true, comandos });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener comandos pendientes' });
    }
};

module.exports = {
    getPiletas, getPileta, getPiletasByPlanta,
    createPileta, updatePileta, deletePileta, bulkAssignLab,
    recibirReporteLaboratorio, getAlertas, getTemperatureHistory,
    getConsumo, getCorrelacionAmbiente, getResistenciasOnRanges,
    crearComando, getComandosRecientes, getComandosPendientes,
};
