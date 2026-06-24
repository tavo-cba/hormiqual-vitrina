const agregadoService = require('../services/agregadoService');

// Obtener todos (Fino y Grueso) unificados
const getAgregados = async (req, res) => {
    try {
        const agregados = await agregadoService.getAgregados(req.db);
        res.status(200).json(agregados);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener agregados' });
    }
};

// Obtener un agregado específico, usando tipoAgregado=Fino|Grueso
const getAgregado = async (req, res) => {
    try {
        const { id } = req.params;
        const tipoAgregado = req.query.tipoAgregado; // o un header
        if (!tipoAgregado) {
            return res.status(400).json({ error: 'Falta tipoAgregado en query' });
        }

        const agregado = await agregadoService.getAgregado(req.db, tipoAgregado, id);
        if (!agregado) {
            return res.status(404).json({ error: 'Agregado no encontrado' });
        }
        res.status(200).json(agregado);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener el agregado' });
    }
};

// Crear un agregado (Fino o Grueso)
const createAgregado = async (req, res) => {
    try {
        const nuevoAgregado = await agregadoService.createAgregado(req.db, req.body);
        res.status(201).json(nuevoAgregado);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear el agregado' });
    }
};

// Actualizar un agregado (Fino o Grueso)
const updateAgregado = async (req, res) => {
    try {
        const { id } = req.params;
        const agregadoActualizado = await agregadoService.updateAgregado(req.db, id, req.body);
        res.status(200).json(agregadoActualizado);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar el agregado' });
    }
};

// Eliminar un agregado (Fino o Grueso)
const deleteAgregado = async (req, res) => {
    try {
        const { id } = req.params;
        const tipoAgregado = req.query.tipoAgregado || req.headers["x-tipo-agregado"];
        if (!tipoAgregado) {
            return res.status(400).json({ error: 'Falta tipoAgregado en query o header' });
        }

        const result = await agregadoService.deleteAgregado(req.db, tipoAgregado, id);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar el agregado' });
    }
};

// Obtener la lista de TamanioMaximoNominal
const getTamaniosMaximos = async (req, res) => {
    try {
        const tamanios = await agregadoService.getTamaniosMaximos(req.db);
        res.status(200).json(tamanios);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener tamanios maximos nominales' });
    }
};

// Recalcular IDA sugerido para un agregado
const recalcularIda = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await agregadoService.recalcularIdaSugerido(req.db, id);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        const status = error.statusCode || 500;
        res.status(status).json({ error: error.message || 'Error al recalcular IDA' });
    }
};

// Actualizar IDA de un agregado (manual override o switch a auto)
const updateIda = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await agregadoService.updateIda(req.db, id, req.body);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        const status = error.statusCode || 500;
        res.status(status).json({ error: error.message || 'Error al actualizar IDA' });
    }
};

module.exports = {
    getAgregados,
    getAgregado,
    createAgregado,
    updateAgregado,
    deleteAgregado,
    getTamaniosMaximos,
    recalcularIda,
    updateIda,
};
