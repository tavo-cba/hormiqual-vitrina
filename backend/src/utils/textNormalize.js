/**
 * Utilidades de normalización de texto compartidas.
 * Usadas por whatsappService y planificacionService para fuzzy matching.
 */

const normalizeText = (value) => {
    if (value == null) return '';
    return String(value)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
};

const collapseAlphanumeric = (value) => normalizeText(value).replace(/[^a-z0-9]/g, '');

module.exports = { normalizeText, collapseAlphanumeric };
