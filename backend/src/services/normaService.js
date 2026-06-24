/**
 * normaService.js – CRUD for the "Catálogo de Normas" + upload / download PDF.
 */
const fs = require('fs');
const path = require('path');
const archivoService = require('./archivoService');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const NORMAS_PREFIX = 'normas';
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB
const ALLOWED_MIME = 'application/pdf';

/* ───────── LIST ───────── */
const getNormas = async (db, params = {}) => {
    const where = {};
    if (params.organismo) where.organismo = params.organismo;

    const normas = await db.Norma.findAll({
        where,
        include: [
            { model: db.NormaArchivo, as: 'archivos' },
            { model: db.NormaAplicaA, as: 'aplicaAOpcion', attributes: ['id', 'nombre'] },
        ],
        order: [['codigo', 'ASC']],
    });
    return normas.map(n => {
        const plain = n.toJSON ? n.toJSON() : { ...n };
        plain.archivos = Array.isArray(plain.archivos) ? plain.archivos : [];
        return plain;
    });
};

/* ───────── GET ONE ───────── */
const getNorma = async (db, id) => {
    const norma = await db.Norma.findByPk(id, {
        include: [
            { model: db.NormaArchivo, as: 'archivos' },
            { model: db.AgregadoEnsayoTipo, as: 'tiposEnsayo', attributes: ['idAgregadoEnsayoTipo', 'codigo', 'nombre'] },
            { model: db.NormaAplicaA, as: 'aplicaAOpcion', attributes: ['id', 'nombre'] },
        ],
    });
    if (!norma) return null;
    const plain = norma.toJSON ? norma.toJSON() : { ...norma };
    plain.archivos = Array.isArray(plain.archivos) ? plain.archivos : [];
    return plain;
};

/* ───────── CREATE ───────── */
const createNorma = async (db, body) => {
    const norma = await db.Norma.create({
        codigo: body.codigo,
        titulo: body.titulo,
        organismo: body.organismo || null,
        version: body.version || null,
        anio: body.anio || null,
        descripcion: body.descripcion || null,
        aplicaA: body.aplicaA || null,
        aplicaAId: body.aplicaAId || null,
    });
    return getNorma(db, norma.id);
};

/* ───────── UPDATE ───────── */
const updateNorma = async (db, id, body) => {
    const norma = await db.Norma.findByPk(id);
    if (!norma) return null;

    await norma.update({
        codigo: body.codigo !== undefined ? body.codigo : norma.codigo,
        titulo: body.titulo !== undefined ? body.titulo : norma.titulo,
        organismo: body.organismo !== undefined ? body.organismo : norma.organismo,
        version: body.version !== undefined ? body.version : norma.version,
        anio: body.anio !== undefined ? body.anio : norma.anio,
        descripcion: body.descripcion !== undefined ? body.descripcion : norma.descripcion,
        aplicaA: body.aplicaA !== undefined ? body.aplicaA : norma.aplicaA,
        aplicaAId: body.aplicaAId !== undefined ? body.aplicaAId : norma.aplicaAId,
    });
    return getNorma(db, id);
};

/* ───────── DELETE ───────── */
const deleteNorma = async (db, id) => {
    const norma = await db.Norma.findByPk(id, {
        include: [{ model: db.NormaArchivo, as: 'archivos' }],
    });
    if (!norma) return null;

    // Delete all files
    for (const archivo of norma.archivos) {
        await _deleteFileFromStorage(archivo.storageKey, db);
    }
    await norma.destroy(); // cascade deletes NormaArchivo rows
    return { message: 'Norma eliminada' };
};

/* ───────── UPLOAD PDF ───────── */
const uploadArchivo = async (db, normaId, file) => {
    const norma = await db.Norma.findByPk(normaId);
    if (!norma) throw Object.assign(new Error('Norma no encontrada'), { status: 404 });

    if (file.mimetype !== ALLOWED_MIME) {
        throw Object.assign(new Error('Solo se aceptan archivos PDF'), { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
        throw Object.assign(new Error(`El archivo excede el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB`), { status: 400 });
    }

    // Delete existing file(s) for this norma (replace semantics)
    const existing = await db.NormaArchivo.findAll({ where: { normaId } });
    for (const old of existing) {
        await _deleteFileFromStorage(old.storageKey, db);
        await old.destroy();
    }

    // Save new file
    const storageKey = await _saveFileToStorage(file, db);

    const archivo = await db.NormaArchivo.create({
        normaId,
        filename: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        size: file.size,
    });

    return archivo;
};

/* ───────── DOWNLOAD ───────── */
const getArchivoStream = async (db, normaId) => {
    const archivo = await db.NormaArchivo.findOne({ where: { normaId } });
    if (!archivo) return null;

    const stream = await archivoService.getFileStream(archivo.storageKey, db);
    return { stream, archivo };
};

/* ───────── DELETE FILE ───────── */
const deleteArchivo = async (db, normaId) => {
    const archivo = await db.NormaArchivo.findOne({ where: { normaId } });
    if (!archivo) return null;

    await _deleteFileFromStorage(archivo.storageKey, db);
    await archivo.destroy();
    return { message: 'Archivo eliminado' };
};

/* ───────── Helpers ───────── */
const useS3 = process.env.STORAGE_DRIVER === 's3';

async function _saveFileToStorage(file, db) {
    if (useS3) {
        const result = await archivoService.uploadToS3Only(file, { prefix: NORMAS_PREFIX }, db);
        return result.key;
    }
    // Local: save to uploads/normas/
    const dir = path.join(UPLOAD_DIR, NORMAS_PREFIX);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const key = `${NORMAS_PREFIX}/${Date.now()}_${file.originalname}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, key), file.buffer);
    return key;
}

async function _deleteFileFromStorage(storageKey, db) {
    try {
        if (useS3) {
            await archivoService.deleteFromKey(storageKey, db);
        } else {
            const filePath = path.join(UPLOAD_DIR, storageKey);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    } catch (err) {
        console.error('[normaService] Error deleting file:', storageKey, err.message);
    }
}

module.exports = {
    getNormas,
    getNorma,
    createNorma,
    updateNorma,
    deleteNorma,
    uploadArchivo,
    getArchivoStream,
    deleteArchivo,
};
