const aguaService = require('../services/aguaService');

const getAll = async (req, res) => {
    try {
        const aguas = await aguaService.getAguas(req.db);
        res.status(200).json(aguas);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener aguas' });
    }
};

const getOne = async (req, res) => {
    try {
        const { id } = req.params;
        const agua = await aguaService.getAgua(req.db, id);
        if (!agua) {
            return res.status(404).json({ error: 'Agua no encontrada' });
        }
        res.status(200).json(agua);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener el agua' });
    }
};

const create = async (req, res) => {
    try {
        const nuevaAgua = await aguaService.createAgua(req.db, req.body);
        res.status(201).json(nuevaAgua);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear el agua' });
    }
};

const update = async (req, res) => {
    try {
        const { id } = req.params;
        const aguaActualizada = await aguaService.updateAgua(req.db, id, req.body);
        res.status(200).json(aguaActualizada);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar el agua' });
    }
};

const remove = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await aguaService.deleteAgua(req.db, id);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar el agua' });
    }
};

const restore = async (req, res) => {
    try {
        const result = await aguaService.restoreAgua(req.db, req.body.id);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al restaurar el agua' });
    }
};

module.exports = {
    getAll,
    getOne,
    create,
    update,
    remove,
    restore
};
