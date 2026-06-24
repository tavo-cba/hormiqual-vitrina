const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { computeGranulometria, canMarcarRevisadoGranulometria, MIN_TAMICES_REVISADO } = require('./granulometriaCalc');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads', 'materiales');

const VALID_TIPOS = ['AGREGADO', 'CEMENTO', 'ADITIVO', 'FIBRA', 'ADICION', 'AGUA'];

/* ── Normalize a category string for robust comparison ── */
const normalizeCategoria = (cat) => {
  if (!cat) return '';
  return cat
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // strip accents
};

const isGranulometriaCategoria = (cat) => normalizeCategoria(cat) === 'granulometria';

const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
];

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const computeSha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const buildStoragePath = (materialTipo, materialId) =>
  path.join(materialTipo.toLowerCase(), String(materialId));

/* ═══════════════════════════════════════════════════════════
   Plantilla lookup — find matching template for (tipo, cat)
   Falls back to GENERICA / Otro if no match.
   ═══════════════════════════════════════════════════════════ */
const findPlantilla = async (db, materialTipo, categoria) => {
  const tipoUpper = materialTipo.toUpperCase();

  // Exact match
  let plantilla = await db.ExtraccionPlantilla.findOne({
    where: { materialTipo: tipoUpper, categoria },
  });
  if (plantilla) return plantilla;

  // Normalized match — try all plantillas for this tipo and compare normalized
  const allForTipo = await db.ExtraccionPlantilla.findAll({ where: { materialTipo: tipoUpper } });
  const normCat = normalizeCategoria(categoria);
  plantilla = allForTipo.find((p) => normalizeCategoria(p.categoria) === normCat) || null;
  if (plantilla) return plantilla;

  // Fallback: same tipo, 'Otro'
  plantilla = await db.ExtraccionPlantilla.findOne({
    where: { materialTipo: materialTipo.toUpperCase(), categoria: 'Otro' },
  });
  if (plantilla) return plantilla;

  // Fallback: GENERICA / Otro
  plantilla = await db.ExtraccionPlantilla.findOne({
    where: { materialTipo: 'GENERICA', categoria: 'Otro' },
  });
  return plantilla;
};

/* ═══════════════════════════════════════════════════════════
   getDocumentos — list documents for a material
   ═══════════════════════════════════════════════════════════ */
const getDocumentos = async (db, materialTipo, materialId) => {
  const docs = await db.MaterialDocumento.findAll({
    where: { materialTipo: materialTipo.toUpperCase(), materialId },
    include: [
      { model: db.CalidadArchivo, as: 'archivo' },
      {
        model: db.ExtraccionDocumento,
        as: 'extraccion',
        include: [{ model: db.ExtraccionPlantilla, as: 'plantilla', attributes: ['idExtraccionPlantilla', 'normaReferencia', 'version', 'schema'] }],
      },
    ],
    order: [['createdAt', 'DESC']],
  });
  return docs.map((d) => d.get({ plain: true }));
};

/* ═══════════════════════════════════════════════════════════
   uploadDocumento — save file + create records
   ═══════════════════════════════════════════════════════════ */
const uploadDocumento = async (db, { materialTipo, materialId, file, categoria, fechaDocumento, notas }) => {
  const tipo = materialTipo.toUpperCase();
  if (!VALID_TIPOS.includes(tipo)) throw new Error(`Tipo de material inválido: ${tipo}`);
  if (!file || !file.buffer) throw new Error('No se recibió un archivo');
  if (!ALLOWED_MIMES.includes(file.mimetype)) throw new Error(`Tipo de archivo no permitido: ${file.mimetype}`);
  if (file.size > MAX_SIZE) throw new Error(`El archivo excede el tamaño máximo de ${MAX_SIZE / 1024 / 1024} MB`);

  const t = await db.sequelize.transaction();
  try {
    // 1. Save file to disk
    const relDir = buildStoragePath(tipo, materialId);
    const absDir = path.join(UPLOADS_ROOT, relDir);
    ensureDir(absDir);

    const ext = path.extname(file.originalname) || '';
    const storedName = `${crypto.randomUUID()}${ext}`;
    const absPath = path.join(absDir, storedName);
    fs.writeFileSync(absPath, file.buffer);

    const sha256 = computeSha256(file.buffer);
    const storagePath = path.join('materiales', relDir, storedName).replace(/\\/g, '/');

    // 2. Create CalidadArchivo
    const archivo = await db.CalidadArchivo.create({
      originalName: file.originalname,
      storedName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      sha256,
      storagePath,
    }, { transaction: t });

    // 3. Create MaterialDocumento
    const doc = await db.MaterialDocumento.create({
      materialTipo: tipo,
      materialId,
      idCalidadArchivo: archivo.idCalidadArchivo,
      categoria: categoria || 'Otro',
      fechaDocumento: fechaDocumento || null,
      notas: notas || null,
    }, { transaction: t });

    // 4. Find matching plantilla and create ExtraccionDocumento
    const plantilla = await findPlantilla(db, tipo, categoria || 'Otro');
    const schemaFields = plantilla ? (typeof plantilla.schema === 'string' ? JSON.parse(plantilla.schema) : plantilla.schema) : [];
    const faltantes = schemaFields
      .filter(f => (f.required !== undefined ? f.required : true))
      .map(f => f.key || f.campo || f.label);

    await db.ExtraccionDocumento.create({
      idMaterialDocumento: doc.idMaterialDocumento,
      idExtraccionPlantilla: plantilla ? plantilla.idExtraccionPlantilla : null,
      estado: 'PENDIENTE',
      jsonExtraido: {},
      faltantes: faltantes.length > 0 ? faltantes : null,
      confianza: null,
    }, { transaction: t });

    await t.commit();

    // Return freshly loaded doc with includes
    return getDocumento(db, doc.idMaterialDocumento);
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

/* ═══════════════════════════════════════════════════════════
   getDocumento — single doc by PK
   ═══════════════════════════════════════════════════════════ */
const getDocumento = async (db, idMaterialDocumento) => {
  const doc = await db.MaterialDocumento.findByPk(idMaterialDocumento, {
    include: [
      { model: db.CalidadArchivo, as: 'archivo' },
      {
        model: db.ExtraccionDocumento,
        as: 'extraccion',
        include: [{ model: db.ExtraccionPlantilla, as: 'plantilla', attributes: ['idExtraccionPlantilla', 'normaReferencia', 'version', 'schema'] }],
      },
    ],
  });
  return doc ? doc.get({ plain: true }) : null;
};

/* ═══════════════════════════════════════════════════════════
   getArchivoForDownload — resolve absolute path for streaming
   ═══════════════════════════════════════════════════════════ */
const getArchivoForDownload = async (db, idCalidadArchivo) => {
  const archivo = await db.CalidadArchivo.findByPk(idCalidadArchivo);
  if (!archivo) return null;
  const plain = archivo.get({ plain: true });
  const absPath = path.join(__dirname, '..', '..', 'uploads', plain.storagePath);
  if (!fs.existsSync(absPath)) return null;
  return { ...plain, absPath };
};

/* ═══════════════════════════════════════════════════════════
   deleteDocumento — remove record + physical file
   ═══════════════════════════════════════════════════════════ */
const deleteDocumento = async (db, idMaterialDocumento) => {
  const doc = await db.MaterialDocumento.findByPk(idMaterialDocumento, {
    include: [{ model: db.CalidadArchivo, as: 'archivo' }],
  });
  if (!doc) throw new Error('Documento no encontrado');

  const t = await db.sequelize.transaction();
  try {
    // delete extraction
    await db.ExtraccionDocumento.destroy({ where: { idMaterialDocumento }, transaction: t });
    // delete doc record
    await doc.destroy({ transaction: t });
    // delete archivo record
    if (doc.archivo) {
      const absPath = path.join(__dirname, '..', '..', 'uploads', doc.archivo.storagePath);
      await db.CalidadArchivo.destroy({ where: { idCalidadArchivo: doc.archivo.idCalidadArchivo }, transaction: t });
      // remove physical file (best-effort)
      try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch { /* ignore */ }
    }
    await t.commit();
    return { message: 'Documento eliminado' };
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

/* ═══════════════════════════════════════════════════════════
   runExtraccion — stub: marks EXTRAIDO with placeholder data
   Uses the plantilla schema to generate realistic faltantes.
   ═══════════════════════════════════════════════════════════ */
const runExtraccion = async (db, idMaterialDocumento) => {
  const ext = await db.ExtraccionDocumento.findOne({
    where: { idMaterialDocumento },
    include: [{ model: db.ExtraccionPlantilla, as: 'plantilla' }],
  });
  if (!ext) throw new Error('Extracción no encontrada');

  const schemaFields = ext.plantilla
    ? (typeof ext.plantilla.schema === 'string' ? JSON.parse(ext.plantilla.schema) : ext.plantilla.schema)
    : [];
  const faltantes = schemaFields
    .filter(f => (f.required !== undefined ? f.required : true))
    .map(f => f.key || f.campo || f.label);

  await ext.update({
    estado: 'EXTRAIDO',
    jsonExtraido: {},
    faltantes: faltantes.length > 0 ? faltantes : null,
    confianza: 0.0,
    errores: null,
  });

  return ext.get({ plain: true });
};

/* ═══════════════════════════════════════════════════════════
   validateAndComputeFaltantes — validate jsonExtraido against
   the plantilla schema. Returns { cleanedData, faltantes, errors }.
   Supports extended schema: key/campo, type/tipo, unit/unidad,
   required (default true), min, max, enum, array, object types.
   ═══════════════════════════════════════════════════════════ */
const isEmpty = (v) =>
  v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '');

const isEmptyArray = (v) => Array.isArray(v) && v.length === 0;

const resolveField = (field) => ({
  key: field.key || field.campo,
  type: field.type || field.tipo || 'string',
  label: field.label || field.key || field.campo,
  unit: field.unit || field.unidad || '',
  required: field.required !== undefined ? field.required : true,
  min: field.min,
  max: field.max,
  enumValues: field.enum || null,
});

const validateAndComputeFaltantes = (schemaFields, jsonExtraido) => {
  const cleanedData = {};
  const faltantes = [];
  const errors = [];

  if (!Array.isArray(schemaFields)) return { cleanedData, faltantes, errors };

  for (const rawField of schemaFields) {
    const field = resolveField(rawField);
    const rawValue = jsonExtraido?.[field.key];

    // Empty check
    if (isEmpty(rawValue) || isEmptyArray(rawValue)) {
      if (field.required) faltantes.push(field.key);
      cleanedData[field.key] = null;
      continue;
    }

    switch (field.type) {
      case 'number': {
        const num = Number(rawValue);
        if (isNaN(num)) {
          errors.push(`${field.label}: debe ser un número`);
          if (field.required) faltantes.push(field.key);
          cleanedData[field.key] = null;
        } else {
          if (field.min !== undefined && num < field.min)
            errors.push(`${field.label}: valor mínimo es ${field.min}`);
          if (field.max !== undefined && num > field.max)
            errors.push(`${field.label}: valor máximo es ${field.max}`);
          cleanedData[field.key] = num;
        }
        break;
      }
      case 'date': {
        const d = new Date(rawValue);
        if (isNaN(d.getTime())) {
          errors.push(`${field.label}: fecha inválida`);
          if (field.required) faltantes.push(field.key);
          cleanedData[field.key] = null;
        } else {
          cleanedData[field.key] = rawValue;
        }
        break;
      }
      case 'string':
      case 'text': {
        const str = String(rawValue).trim();
        if (field.enumValues && Array.isArray(field.enumValues) && !field.enumValues.includes(str)) {
          errors.push(`${field.label}: valor debe ser uno de: ${field.enumValues.join(', ')}`);
        }
        cleanedData[field.key] = str;
        break;
      }
      case 'array': {
        if (Array.isArray(rawValue)) {
          cleanedData[field.key] = rawValue;
        } else {
          try {
            const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
            cleanedData[field.key] = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            errors.push(`${field.label}: debe ser un array`);
            if (field.required) faltantes.push(field.key);
            cleanedData[field.key] = null;
          }
        }
        break;
      }
      case 'object': {
        if (typeof rawValue === 'object' && rawValue !== null && !Array.isArray(rawValue)) {
          cleanedData[field.key] = rawValue;
        } else {
          try {
            const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              cleanedData[field.key] = parsed;
            } else {
              errors.push(`${field.label}: debe ser un objeto`);
              if (field.required) faltantes.push(field.key);
              cleanedData[field.key] = null;
            }
          } catch {
            errors.push(`${field.label}: debe ser un objeto`);
            if (field.required) faltantes.push(field.key);
            cleanedData[field.key] = null;
          }
        }
        break;
      }
      default: {
        cleanedData[field.key] = String(rawValue).trim();
        break;
      }
    }
  }

  return { cleanedData, faltantes, errors };
};

/* ═══════════════════════════════════════════════════════════
   guardarRevision — save jsonExtraido, recalculate faltantes,
   optionally mark as REVISADO (only if faltantes=0).
   Special handling for Granulometría category.
   ═══════════════════════════════════════════════════════════ */
const guardarRevision = async (db, idMaterialDocumento, { jsonExtraido, marcarComoRevisado }) => {
  const ext = await db.ExtraccionDocumento.findOne({
    where: { idMaterialDocumento },
    include: [{ model: db.ExtraccionPlantilla, as: 'plantilla' }],
  });
  if (!ext) throw new Error('Extracción no encontrada');

  // Load the parent doc to check categoria
  const doc = await db.MaterialDocumento.findByPk(idMaterialDocumento);
  const isGranulometria = doc && isGranulometriaCategoria(doc.categoria) && doc.materialTipo === 'AGREGADO';

  const schemaFields = ext.plantilla
    ? (typeof ext.plantilla.schema === 'string' ? JSON.parse(ext.plantilla.schema) : ext.plantilla.schema)
    : [];

  let cleanedData, faltantes, errors;

  if (isGranulometria) {
    // ── Granulometría special path ──────────────────────
    const input = jsonExtraido || {};
    cleanedData = {};
    faltantes = [];
    errors = [];

    // Copy simple fields
    cleanedData.serieTamices = input.serieTamices || 'IRAM';
    cleanedData.tipoAgregado = input.tipoAgregado || null;
    cleanedData.fechaEnsayo = input.fechaEnsayo || null;
    cleanedData.laboratorio = input.laboratorio || null;

    // Validate tamices array
    const tamices = Array.isArray(input.tamices) ? input.tamices : [];
    cleanedData.tamices = tamices.map((t) => ({
      tamiz: t.tamiz || '',
      aberturaMm: Number(t.aberturaMm) || 0,
      pasaPct: t.pasaPct !== null && t.pasaPct !== undefined && t.pasaPct !== '' ? Number(t.pasaPct) : null,
      habilitado: t.habilitado !== false,
    }));

    // Only use enabled tamices with data for calculations
    const tamicesConDatos = cleanedData.tamices.filter((t) => t.habilitado && t.pasaPct !== null);

    if (tamicesConDatos.length === 0) {
      faltantes.push('tamices');
    }

    // Server-side compute
    const { calculos, faltantesGrano, erroresGrano } = computeGranulometria(
      tamicesConDatos,
      cleanedData.tipoAgregado
    );
    cleanedData.calculos = calculos;
    faltantes.push(...faltantesGrano);
    errors.push(...erroresGrano);

    // comparacionCurva — re-compare server-side if curvaId provided, else accept frontend result
    if (input.comparacionCurva && typeof input.comparacionCurva === 'object' && input.comparacionCurva.curvaId) {
      try {
        const curvaService = require('./curvaGranulometricaService');
        const curva = await curvaService.getCurva(db, input.comparacionCurva.curvaId);
        if (curva) {
          const serverResult = curvaService.compararConCurva(tamicesConDatos, curva);
          cleanedData.comparacionCurva = serverResult
            ? { ...serverResult, source: 'server' }
            : { ...input.comparacionCurva, source: 'frontend' };
        } else {
          cleanedData.comparacionCurva = { ...input.comparacionCurva, source: 'frontend', warning: 'Curva no encontrada en server' };
        }
      } catch (err) {
        console.error('[guardarRevision] Error al re-comparar curva server-side:', err.message);
        cleanedData.comparacionCurva = { ...input.comparacionCurva, source: 'frontend' };
      }
    } else if (input.comparacionCurva && typeof input.comparacionCurva === 'object') {
      cleanedData.comparacionCurva = { ...input.comparacionCurva, source: 'frontend' };
    } else {
      cleanedData.comparacionCurva = null;
    }

    // Check required fields from schema (non-tamiz fields)
    for (const rawField of schemaFields) {
      const field = resolveField(rawField);
      if (field.key === 'tamices' || field.key === 'calculos' || field.key === 'comparacionCurva') continue;
      if (field.required && isEmpty(cleanedData[field.key])) {
        faltantes.push(field.key);
      }
    }

    // Determine state for granulometría
    let estado;
    let mensaje = null;

    if (marcarComoRevisado) {
      const canRevisar = canMarcarRevisadoGranulometria(calculos, erroresGrano) && faltantes.length === 0;
      if (!canRevisar) {
        const reasons = [];
        if (erroresGrano.length > 0) reasons.push('hay errores de validación');
        if (calculos && calculos.cantidadTamices < MIN_TAMICES_REVISADO) reasons.push(`se necesitan al menos ${MIN_TAMICES_REVISADO} tamices`);
        if (calculos && !calculos.validaMonotonia) reasons.push('la monotonicidad no se cumple');
        if (faltantes.length > 0) reasons.push(`faltan ${faltantes.length} campo(s) requerido(s)`);
        estado = tamicesConDatos.length > 0 ? 'INCOMPLETO' : 'PENDIENTE';
        mensaje = `No se puede marcar como revisado: ${reasons.join(', ')}`;
      } else {
        estado = 'REVISADO';
      }
    } else if (tamicesConDatos.length > 0) {
      estado = 'INCOMPLETO';
    } else {
      estado = 'PENDIENTE';
    }

    await ext.update({
      jsonExtraido: cleanedData,
      faltantes: faltantes.length > 0 ? faltantes : null,
      estado,
      errores: errors.length > 0 ? errors.join('; ') : null,
    });

    const result = await getDocumento(db, idMaterialDocumento);
    if (mensaje) result._mensaje = mensaje;
    return result;
  }

  // ── Generic (non-granulometría) path ─────────────────
  ({ cleanedData, faltantes, errors } = validateAndComputeFaltantes(schemaFields, jsonExtraido || {}));

  // Determine state
  let estado;
  let mensaje = null;

  if (marcarComoRevisado) {
    if (faltantes.length > 0) {
      estado = Object.values(cleanedData).some((v) => v !== null) ? 'INCOMPLETO' : 'PENDIENTE';
      mensaje = `No se puede marcar como revisado: faltan ${faltantes.length} campo(s) requerido(s)`;
    } else {
      estado = 'REVISADO';
    }
  } else if (Object.values(cleanedData).some((v) => v !== null)) {
    estado = 'INCOMPLETO';
  } else {
    estado = 'PENDIENTE';
  }

  await ext.update({
    jsonExtraido: cleanedData,
    faltantes: faltantes.length > 0 ? faltantes : null,
    estado,
    errores: errors.length > 0 ? errors.join('; ') : null,
  });

  const result = await getDocumento(db, idMaterialDocumento);
  if (mensaje) result._mensaje = mensaje;
  return result;
};

/* ═══════════════════════════════════════════════════════════
   marcarRevisado — quick action: mark extraction as REVISADO
   ═══════════════════════════════════════════════════════════ */
const marcarRevisado = async (db, idMaterialDocumento) => {
  const ext = await db.ExtraccionDocumento.findOne({ where: { idMaterialDocumento } });
  if (!ext) throw new Error('Extracción no encontrada');

  await ext.update({ estado: 'REVISADO' });
  return ext.get({ plain: true });
};

module.exports = {
  getDocumentos,
  uploadDocumento,
  getDocumento,
  getArchivoForDownload,
  deleteDocumento,
  runExtraccion,
  guardarRevision,
  marcarRevisado,
  findPlantilla,
  ALLOWED_MIMES,
  MAX_SIZE,
};
