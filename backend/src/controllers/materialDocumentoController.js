const materialDocumentoService = require('../services/materialDocumentoService');

/* ── Get single documento detail ─────────────────────── */
const getDocumento = async (req, res) => {
  try {
    const { materialDocumentoId } = req.params;
    const doc = await materialDocumentoService.getDocumento(req.db, materialDocumentoId);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    res.status(200).json(doc);
  } catch (error) {
    console.error('Error al obtener documento:', error);
    res.status(500).json({ error: 'Error al obtener documento' });
  }
};

/* ── List documentos for a material ──────────────────── */
const getDocumentos = async (req, res) => {
  try {
    const { materialTipo, materialId } = req.params;
    const docs = await materialDocumentoService.getDocumentos(req.db, materialTipo, materialId);
    res.status(200).json(docs);
  } catch (error) {
    console.error('Error al obtener documentos:', error);
    res.status(500).json({ error: 'Error al obtener documentos' });
  }
};

/* ── Upload documento ────────────────────────────────── */
const uploadDocumento = async (req, res) => {
  try {
    const { materialTipo, materialId } = req.params;
    const { categoria, fechaDocumento, notas } = req.body;
    const file = req.file;

    const doc = await materialDocumentoService.uploadDocumento(req.db, {
      materialTipo,
      materialId: Number(materialId),
      file,
      categoria,
      fechaDocumento: fechaDocumento || null,
      notas: notas || null,
    });

    res.status(201).json(doc);
  } catch (error) {
    console.error('Error al subir documento:', error);
    const status = error.message.includes('inválido') || error.message.includes('no permitido') || error.message.includes('excede') ? 400 : 500;
    res.status(status).json({ error: error.message || 'Error al subir documento' });
  }
};

/* ── Download / view archivo ─────────────────────────── */
const downloadArchivo = async (req, res) => {
  try {
    const { archivoId } = req.params;
    const archivo = await materialDocumentoService.getArchivoForDownload(req.db, archivoId);
    if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });

    res.setHeader('Content-Type', archivo.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(archivo.originalName)}"`);
    res.sendFile(archivo.absPath);
  } catch (error) {
    console.error('Error al descargar archivo:', error);
    res.status(500).json({ error: 'Error al descargar archivo' });
  }
};

/* ── Delete documento ────────────────────────────────── */
const deleteDocumento = async (req, res) => {
  try {
    const { materialDocumentoId } = req.params;
    const result = await materialDocumentoService.deleteDocumento(req.db, materialDocumentoId);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error al eliminar documento:', error);
    const status = error.message.includes('no encontrado') ? 404 : 500;
    res.status(status).json({ error: error.message || 'Error al eliminar documento' });
  }
};

/* ── Run extraction stub ─────────────────────────────── */
const runExtraccion = async (req, res) => {
  try {
    const { materialDocumentoId } = req.params;
    const result = await materialDocumentoService.runExtraccion(req.db, materialDocumentoId);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error al ejecutar extracción:', error);
    res.status(500).json({ error: error.message || 'Error al ejecutar extracción' });
  }
};

/* ── Mark as revisado ────────────────────────────────── */
const marcarRevisado = async (req, res) => {
  try {
    const { materialDocumentoId } = req.params;
    const result = await materialDocumentoService.marcarRevisado(req.db, materialDocumentoId);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error al marcar como revisado:', error);
    res.status(500).json({ error: error.message || 'Error al marcar como revisado' });
  }
};

/* ── Save revision data ──────────────────────────────── */
const guardarRevision = async (req, res) => {
  try {
    const { materialDocumentoId } = req.params;
    const { jsonExtraido, marcarComoRevisado } = req.body;
    const result = await materialDocumentoService.guardarRevision(req.db, materialDocumentoId, {
      jsonExtraido: jsonExtraido || {},
      marcarComoRevisado: !!marcarComoRevisado,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error('Error al guardar revisión:', error);
    const status = error.message.includes('no encontrada') ? 404 : 500;
    res.status(status).json({ error: error.message || 'Error al guardar revisión' });
  }
};

module.exports = { getDocumento, getDocumentos, uploadDocumento, downloadArchivo, deleteDocumento, runExtraccion, marcarRevisado, guardarRevision };
