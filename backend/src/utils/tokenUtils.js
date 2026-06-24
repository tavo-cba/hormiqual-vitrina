const crypto = require('crypto');

const generateSecureToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

const isTokenExpired = (expiresAt) => new Date() > new Date(expiresAt);

module.exports = { generateSecureToken, isTokenExpired };
