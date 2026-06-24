const { createDbConnection } = require('../models');

async function verifyLabApiKey(req, res, next) {
    try {
        const apiKey = req.headers['x-lab-api-key'];
        const tenant = req.headers['x-tenant'];

        if (!apiKey || !tenant) {
            return res.status(401).json({ error: 'Credenciales de laboratorio no proporcionadas' });
        }

        const db = await createDbConnection(tenant);
        const config = await db.Config.findOne({ attributes: ['labApiKey'] });

        if (!config || !config.labApiKey || config.labApiKey !== apiKey) {
            return res.status(403).json({ error: 'API key de laboratorio invalida' });
        }

        req.db = db;
        next();
    } catch (err) {
        console.error('Error en verifyLabApiKey:', err.message);
        res.status(500).json({ error: 'Error de autenticacion del laboratorio' });
    }
}

module.exports = { verifyLabApiKey };
