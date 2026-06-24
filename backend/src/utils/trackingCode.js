/**
 * Generador de codigos de seguimiento para ordenes de venta.
 * Formato: OV-XXXXXX (6 caracteres alfanumericos sin ambiguos)
 */

// Charset sin caracteres ambiguos: sin O/0, I/1/L
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const generateCode = () => {
    let code = 'OV-';
    for (let i = 0; i < 6; i++) {
        code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
    }
    return code;
};

/**
 * Genera un codigo unico verificando contra la base de datos.
 * @param {object} db - Instancia de modelos Sequelize
 * @param {number} maxRetries - Intentos maximos antes de fallar
 * @returns {Promise<string>} Codigo unico generado
 */
const generateUniqueCode = async (db, maxRetries = 5) => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const code = generateCode();
        const existing = await db.OrdenVenta.findOne({
            where: { codigoSeguimiento: code },
            attributes: ['idOrdenVenta'],
        });
        if (!existing) return code;
    }
    throw new Error('No se pudo generar un codigo de seguimiento unico despues de varios intentos');
};

module.exports = { generateUniqueCode, generateCode };
