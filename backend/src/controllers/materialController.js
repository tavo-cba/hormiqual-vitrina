const materialService = require('../services/materialService');

const getTipos = async (req, res) => {
  try {
    const tipos = await materialService.getTipos(req.db);
    res.status(200).json(tipos);
  } catch (error) {
    console.error('Error al obtener tipos de material:', error);
    res.status(500).json({ error: 'Error al obtener tipos de material' });
  }
};

const getMateriales = async (req, res) => {
  try {
    const { tipo, includeArchived, idPlanta } = req.query; // ?tipo=2  or  ?tipo=ALL  &includeArchived=true  &idPlanta=N
    const isAll = !tipo || tipo === 'ALL' || tipo === 'all' || tipo === 'todos';
    const result = await materialService.getMateriales(req.db, {
      idMaterialTipo: isAll ? undefined : tipo,
      returnMeta: isAll,
      includeArchived: includeArchived === 'true',
      idPlanta: idPlanta != null && idPlanta !== '' ? Number(idPlanta) : null,
    });

    if (isAll) {
      // { data: [...], meta: { counts: {...} } }
      res.status(200).json(result);
    } else {
      // backward-compat: plain array for single-type queries
      res.status(200).json(result);
    }
  } catch (error) {
    console.error('Error al obtener materiales:', error);
    res.status(500).json({ error: 'Error al obtener materiales' });
  }
};

const getMaterial = async (req, res) => {
  try {
    const material = await materialService.getMaterial(req.db, req.params.id);
    if (!material) return res.status(404).json({ error: 'Material no encontrado' });
    res.status(200).json(material);
  } catch (error) {
    console.error('Error al obtener material:', error);
    res.status(500).json({ error: 'Error al obtener el material' });
  }
};

const createMaterial = async (req, res) => {
  try {
    const nuevo = await materialService.createMaterial(req.db, req.body);
    res.status(201).json(nuevo);
  } catch (error) {
    console.error('Error al crear material:', error);
    res.status(500).json({ error: 'Error al crear el material' });
  }
};

const updateMaterial = async (req, res) => {
  try {
    const actualizado = await materialService.updateMaterial(req.db, req.params.id, req.body);
    res.status(200).json(actualizado);
  } catch (error) {
    console.error('Error al actualizar material:', error);
    res.status(500).json({ error: 'Error al actualizar el material' });
  }
};

const deleteMaterial = async (req, res) => {
  try {
    const result = await materialService.deleteMaterial(req.db, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error al borrar material:', error);
    res.status(500).json({ error: 'Error al borrar el material' });
  }
};

const restoreMaterial = async (req, res) => {
  try {
    const { source, sourceId } = req.body;
    if (!source || !sourceId) {
      return res.status(400).json({ error: 'Faltan source y sourceId' });
    }
    const result = await materialService.restoreMaterial(req.db, source, sourceId);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error al restaurar material:', error);
    res.status(500).json({ error: 'Error al restaurar el material' });
  }
};

module.exports = { getTipos, getMateriales, getMaterial, createMaterial, updateMaterial, deleteMaterial, restoreMaterial };
