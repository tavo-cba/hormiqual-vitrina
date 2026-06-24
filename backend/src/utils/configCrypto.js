'use strict';

/**
 * configCrypto.js — Cifrado simétrico de credenciales en la tabla `Config`.
 *
 * Por qué existe:
 *   La tabla Config guarda credenciales sensibles (geolockerApiKey,
 *   whatsappApiKey, s3SecretAccessKey, mailPassword, claudeApiKey, etc.).
 *   Históricamente quedaron en texto plano — lo que las expone en cualquier
 *   dump de DB, log de query, snapshot de backup o consulta directa.
 *
 *   Esta utility provee `encryptString`/`decryptString` y se invoca desde
 *   hooks `beforeSave`/`afterFind` del modelo Config (ver `models/Config.js`).
 *
 * Diseño:
 *   - Algoritmo: AES-256-GCM (cifrado autenticado).
 *   - Key: derivada de `process.env.CONFIG_ENC_KEY` via SHA-256 (acepta
 *     cualquier longitud de input, la normaliza a 32 bytes).
 *   - IV: 12 bytes random por valor (recomendado para GCM).
 *   - Auth tag: 16 bytes (default).
 *   - Formato de salida: `enc:v1:{iv-base64}:{ciphertext-base64}:{tag-base64}`
 *     El prefijo `enc:v1:` permite:
 *       (a) detectar idempotencia (no re-encriptar lo ya encriptado),
 *       (b) backward compat (valores plain en DB siguen funcionando),
 *       (c) versionado por si en el futuro cambiamos a v2.
 *
 *   - Si `CONFIG_ENC_KEY` no está definido: degradación grácil — se loggea
 *     un warning una sola vez y los hooks no encriptan. Esto permite correr
 *     el backend en dev local sin configurar la key. En producción se debe
 *     setear sí o sí (verificar con `requireConfigEncKey()` al bootear).
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const PREFIX = 'enc:v1:';

let _cachedKey = null;
let _warnedMissing = false;

/**
 * Devuelve la clave AES-256 derivada de CONFIG_ENC_KEY (Buffer de 32 bytes).
 * Cachea el resultado para evitar recalcular SHA-256 en cada operación.
 * Devuelve null si la env var no está seteada.
 */
function getKey() {
    if (_cachedKey) return _cachedKey;
    const raw = process.env.CONFIG_ENC_KEY;
    if (!raw) {
        if (!_warnedMissing && process.env.NODE_ENV !== 'test') {
            _warnedMissing = true;
            // eslint-disable-next-line no-console
            console.warn('[configCrypto] CONFIG_ENC_KEY no definido — credenciales en Config quedan en texto plano. Setealo en .env para habilitar cifrado.');
        }
        return null;
    }
    _cachedKey = crypto.createHash('sha256').update(String(raw), 'utf8').digest();
    return _cachedKey;
}

/**
 * Resetea el cache de la key. Útil en tests cuando se cambia la env var.
 * @internal
 */
function _resetKeyCache() {
    _cachedKey = null;
    _warnedMissing = false;
}

/**
 * True si el string parece estar encriptado (tiene el prefijo `enc:v1:`).
 */
function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encripta un string plain text. Si ya está encriptado (tiene prefijo),
 * lo devuelve tal cual (idempotente). Si no hay key disponible, también
 * devuelve el plain (degradación grácil).
 *
 * @param {string|null|undefined} plain
 * @returns {string|null|undefined}
 */
function encryptString(plain) {
    if (plain == null || plain === '') return plain;
    if (typeof plain !== 'string') return plain;
    if (isEncrypted(plain)) return plain;

    const key = getKey();
    if (!key) return plain;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`;
}

/**
 * Decripta un string. Si no tiene prefijo `enc:v1:` (legacy plain), lo
 * devuelve tal cual. Si la decripción falla (key incorrecta o dato corrupto),
 * loggea error y devuelve null para no romper el flujo de lectura.
 *
 * @param {string|null|undefined} ciphertext
 * @returns {string|null|undefined}
 */
function decryptString(ciphertext) {
    if (ciphertext == null || ciphertext === '') return ciphertext;
    if (typeof ciphertext !== 'string') return ciphertext;
    if (!isEncrypted(ciphertext)) return ciphertext; // legacy plain

    const key = getKey();
    if (!key) {
        // eslint-disable-next-line no-console
        console.warn('[configCrypto] Intento de decripción sin CONFIG_ENC_KEY definido. Devolviendo null.');
        return null;
    }

    try {
        const body = ciphertext.slice(PREFIX.length);
        const [ivB64, ctB64, tagB64] = body.split(':');
        if (!ivB64 || !ctB64 || !tagB64) throw new Error('formato inválido');
        const iv = Buffer.from(ivB64, 'base64');
        const ct = Buffer.from(ctB64, 'base64');
        const tag = Buffer.from(tagB64, 'base64');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
        return plain.toString('utf8');
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[configCrypto] decryptString falló:', err.message);
        return null;
    }
}

/**
 * Lista canónica de campos del modelo Config que deben encriptarse. Mantener
 * sincronizada con el modelo y con la migración de re-encriptación.
 */
const CAMPOS_SENSIBLES = Object.freeze([
    'mailPassword',
    'imapPassword',
    'apiKeyRsv',
    'apiKeyMaps',
    'apiGPTKey',
    'whatsappApiKey',
    'claudeApiKey',
    's3AccessKeyId',
    's3SecretAccessKey',
    'geolockerApiKey',
    'labApiKey',
]);

/**
 * Aplica `encryptString` a cada campo sensible de un instance/plain object
 * que esté cambiado o nuevo. Diseñado para llamarse desde `beforeSave`.
 *
 * @param {Object} instance - Sequelize instance o plain object
 */
function encryptSensitiveFieldsBeforeSave(instance) {
    if (!instance) return;
    const isSequelizeInstance = typeof instance.changed === 'function';
    for (const field of CAMPOS_SENSIBLES) {
        if (isSequelizeInstance) {
            if (!instance.changed(field)) continue;
            const value = instance.get(field);
            if (value == null || value === '' || isEncrypted(value)) continue;
            instance.set(field, encryptString(value));
        } else {
            const value = instance[field];
            if (value == null || value === '' || isEncrypted(value)) continue;
            instance[field] = encryptString(value);
        }
    }
}

/**
 * Aplica `decryptString` a cada campo sensible de un instance/plain object.
 * Diseñado para llamarse desde `afterFind`. Maneja tanto resultados únicos
 * como arrays.
 *
 * @param {Object|Array|null} result
 */
function decryptSensitiveFieldsAfterFind(result) {
    if (result == null) return;
    const apply = (r) => {
        if (!r) return;
        const isSequelizeInstance = typeof r.get === 'function';
        for (const field of CAMPOS_SENSIBLES) {
            const value = isSequelizeInstance ? r.get(field) : r[field];
            if (value == null || value === '' || !isEncrypted(value)) continue;
            const plain = decryptString(value);
            // setDataValue evita marcar el campo como `changed` y dispara update accidental
            if (isSequelizeInstance) r.setDataValue(field, plain);
            else r[field] = plain;
        }
    };
    if (Array.isArray(result)) result.forEach(apply);
    else apply(result);
}

module.exports = {
    encryptString,
    decryptString,
    isEncrypted,
    encryptSensitiveFieldsBeforeSave,
    decryptSensitiveFieldsAfterFind,
    CAMPOS_SENSIBLES,
    PREFIX,
    _resetKeyCache,
};
