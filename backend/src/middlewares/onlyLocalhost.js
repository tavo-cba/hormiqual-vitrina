function isLoopback(addr = '') {
  if (addr === '::1') return true;

  if (addr.startsWith('127.')) return true;

  if (addr.startsWith('::ffff:127.')) return true;

  return false;
}

const { createDbConnection } = require('../models');

async function onlyLocalhost(req, res, next) {
  const remote = req.socket?.remoteAddress || req.connection?.remoteAddress || '';

  if (!isLoopback(remote)) {
    return res.status(403).json({ error: 'Forbidden: local requests only' });
  }

  const tenant = req.headers['x-tenant'];

  if (!tenant) {
    return res.status(400).json({ error: 'Missing tenant header' });
  }

  try {
    req.db = await createDbConnection(tenant);
    return next();
  } catch (err) {
    console.error('Only Local: Error creando conexión para tenant:', err.message, tenant);
    return res.status(500).json({ error: 'Error de conexión con la base de datos del cliente' });
  }
}

// Variante sin requerimiento de header x-tenant ni creación de req.db.
// Para endpoints internos que NO operan sobre un tenant específico (ej: listar
// tenants disponibles) o que reciben el tenant como query param y arman su
// propia conexión a DB.
function onlyLocalhostBare(req, res, next) {
  const remote = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  if (!isLoopback(remote)) {
    return res.status(403).json({ error: 'Forbidden: local requests only' });
  }
  return next();
}

module.exports = { onlyLocalhost, onlyLocalhostBare };