const cementoService = require('../services/cementoService');

const getCementos = async (req, res) => {
    try {
        const idPlanta = req.query.idPlanta != null ? Number(req.query.idPlanta) : null;
        const includeArchived = req.query.includeArchived === 'true';
        const cementos = await cementoService.getCementos(req.db, { idPlanta, includeArchived });
        res.status(200).json(cementos);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener cementos' });
    }
};

const getCemento = async (req, res) => {
    try {
        const { id } = req.params;
        const cemento = await cementoService.getCemento(req.db, id);
        if (!cemento) {
            return res.status(404).json({ error: 'Cemento no encontrado' });
        }
        res.status(200).json(cemento);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener el cemento' });
    }
};

const createCemento = async (req, res) => {
    try {
        const nuevoCemento = await cementoService.createCemento(req.db, req.body);
        res.status(201).json(nuevoCemento);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear el cemento' });
    }
};

const updateCemento = async (req, res) => {
    try {
        const { id } = req.params;
        const cementoActualizado = await cementoService.updateCemento(req.db, id, req.body);
        res.status(200).json(cementoActualizado);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar el cemento' });
    }
};

const deleteCemento = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await cementoService.deleteCemento(req.db, id);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar el cemento' });
    }
};

module.exports = {
    getCementos,
    getCemento,
    createCemento,
    updateCemento,
    deleteCemento
};
