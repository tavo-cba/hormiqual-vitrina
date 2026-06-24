const normaService = require('../services/normaService');

// ─── LIST ───────────────────────────────────────────────────
const getNormas = async (req, res) => {
    try {
        const data = await normaService.getNormas(req.db, req.query);
        res.json(data);
    } catch (err) {
        console.error('[normaController] getNormas error:', err);
        res.status(500).json({ error: 'Error al obtener normas' });
    }
};

// ─── GET ONE ────────────────────────────────────────────────
const getNorma = async (req, res) => {
    try {
        const norma = await normaService.getNorma(req.db, req.params.id);
        if (!norma) return res.status(404).json({ error: 'Norma no encontrada' });
        res.json(norma);
    } catch (err) {
        console.error('[normaController] getNorma error:', err);
        res.status(500).json({ error: 'Error al obtener norma' });
    }
};

// ─── CREATE ─────────────────────────────────────────────────
const createNorma = async (req, res) => {
    try {
        const norma = await normaService.createNorma(req.db, req.body);
        res.status(201).json(norma);
    } catch (err) {
        console.error('[normaController] createNorma error:', err);
        const status = err.name === 'SequelizeUniqueConstraintError' ? 409 : 500;
        res.status(status).json({ error: err.message || 'Error al crear norma' });
    }
};

// ─── UPDATE ─────────────────────────────────────────────────
const updateNorma = async (req, res) => {
    try {
        const norma = await normaService.updateNorma(req.db, req.params.id, req.body);
        if (!norma) return res.status(404).json({ error: 'Norma no encontrada' });
        res.json(norma);
    } catch (err) {
        console.error('[normaController] updateNorma error:', err);
        const status = err.name === 'SequelizeUniqueConstraintError' ? 409 : 500;
        res.status(status).json({ error: err.message || 'Error al actualizar norma' });
    }
};

// ─── DELETE ─────────────────────────────────────────────────
const deleteNorma = async (req, res) => {
    try {
        const result = await normaService.deleteNorma(req.db, req.params.id);
        if (!result) return res.status(404).json({ error: 'Norma no encontrada' });
        res.json(result);
    } catch (err) {
        console.error('[normaController] deleteNorma error:', err);
        res.status(500).json({ error: 'Error al eliminar norma' });
    }
};

// ─── UPLOAD PDF ─────────────────────────────────────────────
const uploadArchivo = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió archivo' });
        const archivo = await normaService.uploadArchivo(req.db, req.params.id, req.file);
        res.status(201).json(archivo);
    } catch (err) {
        console.error('[normaController] uploadArchivo error:', err);
        res.status(err.status || 500).json({ error: err.message || 'Error al subir archivo' });
    }
};

// ─── DOWNLOAD ───────────────────────────────────────────────
const downloadArchivo = async (req, res) => {
    try {
        const result = await normaService.getArchivoStream(req.db, req.params.id);
        if (!result) return res.status(404).json({ error: 'No hay archivo para esta norma' });

        const { stream, archivo } = result;
        res.set('Content-Type', archivo.mimeType);
        res.set('Content-Disposition', `inline; filename="${archivo.filename}"`);
        if (archivo.size) res.set('Content-Length', archivo.size);
        stream.pipe(res);
    } catch (err) {
        console.error('[normaController] downloadArchivo error:', err);
        res.status(500).json({ error: 'Error al descargar archivo' });
    }
};

// ─── DELETE FILE ────────────────────────────────────────────
const deleteArchivo = async (req, res) => {
    try {
        const result = await normaService.deleteArchivo(req.db, req.params.id);
        if (!result) return res.status(404).json({ error: 'No hay archivo para esta norma' });
        res.json(result);
    } catch (err) {
        console.error('[normaController] deleteArchivo error:', err);
        res.status(500).json({ error: 'Error al eliminar archivo' });
    }
};

module.exports = {
    getNormas,
    getNorma,
    createNorma,
    updateNorma,
    deleteNorma,
    uploadArchivo,
    downloadArchivo,
    deleteArchivo,
};
