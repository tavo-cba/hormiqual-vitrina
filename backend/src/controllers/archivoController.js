const archivoService = require('../services/archivoService');

const uploadArchivo = async (req, res) => {
    try {
        // multer guarda el archivo en req.file  (single)  o req.files (array)
        const saved = await Promise.all(
            req.files.map((f) => archivoService.saveFile(req.db, f, req.body))
        );
        res.status(201).json(saved);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al subir archivo' });
    }
};

const getArchivos = async (req, res) => {
    try {
        const archivos = await archivoService.getArchivos(req.db, req.query);
        res.status(200).json(archivos);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener archivos' });
    }
};

const getArchivo = async (req, res) => {
    try {
        const archivo = await archivoService.getArchivo(req.db, req.params.id);
        res.status(200).json(archivo);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener archivo' });
    }
};
const updateArchivo = async (req, res) => {
  try {
    const archivo = await archivoService.updateArchivo(
      req.db,
      req.params.id,
      req.body           // ← { idCategoriaArchivo: ... }
    );
    res.status(200).json(archivo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al actualizar archivo' });
  }
};
const deleteArchivo = async (req, res) => {
    try {
        await archivoService.deleteArchivo(req.db, req.params.id);
        res.status(200).json({ message: 'Archivo eliminado' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al eliminar archivo' });
    }
};

const uploadS3Only = async (req, res) => {
  try {
    // multer guarda en req.file
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    const result = await archivoService.uploadToS3Only(file, req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al subir sólo a S3' });
  }
};

const createCategoria = async (req, res) => {
  try {
    const cat = await archivoService.createCategoria(req.db, req.body);
    res.status(201).json(cat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al crear categoría' });
  }
};

const updateCategoria = async (req, res) => {
  try {
    const cat = await archivoService.updateCategoria(req.db, req.params.id, req.body);
    res.status(200).json(cat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al actualizar categoría' });
  }
};

const deleteCategoria = async (req, res) => {
  try {
    const msg = await archivoService.deleteCategoria(req.db, req.params.id);
    res.status(200).json(msg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al eliminar categoría' });
  }
};

const getCategorias = async (req, res) => {
  try {
    const list = await archivoService.getCategorias(req.db);
    res.status(200).json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al obtener categorías' });
  }
};

const downloadArchivo = async (req, res) => {
  try {
    const archivo = await archivoService.getArchivo(req.db, req.params.id);
    if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });

    const stream = await archivoService.getFileStream(archivo.key);
    if (!stream) return res.status(404).json({ error: 'Archivo no encontrado en storage' });

    res.setHeader('Content-Type', archivo.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(archivo.nombreOriginal)}"`);
    stream.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al descargar archivo' });
  }
};

module.exports = {
  uploadArchivo,
  getArchivos,
  getArchivo,
  deleteArchivo,
  downloadArchivo,
  uploadS3Only,
  createCategoria,
  updateCategoria,
  deleteCategoria,
  getCategorias,
  updateArchivo,
};
