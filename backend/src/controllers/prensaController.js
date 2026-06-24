const prensaService = require('../services/prensaService');

const getPrensas = async (req, res) => {
    try {
        const prensas = await prensaService.getPrensas(req.db);
        res.status(200).json(prensas);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener prensas' });
    }
};

const getPrensa = async (req, res) => {
    try {
        const idPrensa = req.params.id;
        const prensa = await prensaService.getPrensa(req.db, idPrensa);
        res.status(200).json(prensa);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener la prensa' });
    }
};

const createPrensa = async (req, res) => {
    try {
        const nuevaPrensa = await prensaService.createPrensa(req.db, req.body);
        res.status(201).json(nuevaPrensa);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear la prensa' });
    }
};

const updatePrensa = async (req, res) => {
    try {
        const idPrensa = req.params.id;
        const prensaActualizada = await prensaService.updatePrensa(req.db, idPrensa, req.body);
        res.status(200).json(prensaActualizada);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar la prensa' });
    }
};

const deletePrensa = async (req, res) => {
    try {
        const idPrensa = req.params.id;
        await prensaService.deletePrensa(req.db, idPrensa);
        res.status(200).json({ message: 'Prensa eliminada correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar la prensa' });
    }
};

const getUnidadesMedidaPrensa = async (req, res) => {
  try {
    const unidades = await prensaService.getUnidadesMedidaPrensa(req.db);
    res.status(200).json(unidades);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener unidades de medida" });
  }
};

module.exports = {
    getPrensas,
    getPrensa,
    createPrensa,
    updatePrensa,
    deletePrensa,
    getUnidadesMedidaPrensa
};
