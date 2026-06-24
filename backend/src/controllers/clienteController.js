const clienteService = require('../services/clienteService');
// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// const { generateResumenCuentaPdf, getResumenCuentaMeta } = require('../services/clienteResumenPdfService');
// const clienteResumenService = require('../services/clienteResumenService');

const getClientes = async (req, res) => {
    try {
        const clientes = await clienteService.getClientes(req.db);
        res.status(200).json(clientes);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
};

const getCliente = async (req, res) => {
    try {
        const clienteId = req.params.id;
        const cliente = await clienteService.getCliente(req.db, clienteId);
        res.status(200).json(cliente);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener el cliente' });
    }
};

const createCliente = async (req, res) => {
    try {
        const nuevoCliente = await clienteService.createCliente(req.db, req.body);
        res.status(201).json(nuevoCliente);
    } catch (error) {
        console.error(error);
        const status = error.status || 500;
        res.status(status).json({ error: error.status ? error.message : 'Error al crear el cliente' });
    }
};

const updateCliente = async (req, res) => {
    try {
        const clienteId = req.params.id;
        const clienteActualizado = await clienteService.updateCliente(req.db, clienteId, req.body);
        res.status(200).json(clienteActualizado);
    } catch (error) {
        console.error(error);
        const status = error.status || 500;
        res.status(status).json({ error: error.status ? error.message : 'Error al actualizar el cliente' });
    }
};

const deleteCliente = async (req, res) => {
    try {
        const clienteId = req.params.id;
        await clienteService.deleteCliente(req.db, clienteId);
        res.status(200).json({ message: 'Cliente eliminado correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar el cliente' });
    }
};

const getRemitosDespacho = async (req, res) => {
    try {
        const archivos = await clienteService.getRemitosDespacho(req.db, req.params.id);
        res.status(200).json(archivos);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener remitos de despacho' });
    }
};

// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// (resumen de cuenta del cliente — clienteResumenService / clienteResumenPdfService)
const getResumen = async (req, res) =>
    res.status(501).json({ error: 'Función no disponible en la versión vitrina (módulo Calidad).' });

const getResumenCuenta = async (req, res) =>
    res.status(501).json({ error: 'Función no disponible en la versión vitrina (módulo Calidad).' });

module.exports = {
    getClientes,
    getCliente,
    createCliente,
    updateCliente,
    deleteCliente,
    getRemitosDespacho,
    getResumen,
    getResumenCuenta,
};
