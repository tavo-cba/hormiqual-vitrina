const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');

/* ───────── S3 client cache per tenant ───────── */
const _s3Clients = {};

function _getS3Config(db) {
  // Try tenant-specific config from DB cache (set by caller)
  // Fallback to env vars
  const tenantId = db?._tenantId;
  if (tenantId && _s3Clients[tenantId]?._config) {
    return _s3Clients[tenantId]._config;
  }
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.S3_REGION,
    bucket: process.env.S3_BUCKET,
  };
}

async function _loadTenantS3Config(db) {
  if (!db?._tenantId) return _getS3Config(db);
  const tenantId = db._tenantId;

  // Return cached config
  if (_s3Clients[tenantId]?._config) return _s3Clients[tenantId]._config;

  try {
    const config = await db.Config.findOne();
    if (config?.s3Bucket && config?.s3AccessKeyId) {
      const cfg = {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
        region: config.s3Region || process.env.S3_REGION || 'sa-east-1',
        bucket: config.s3Bucket,
      };
      if (!_s3Clients[tenantId]) _s3Clients[tenantId] = {};
      _s3Clients[tenantId]._config = cfg;
      // Invalidate after 30 min
      setTimeout(() => { if (_s3Clients[tenantId]) delete _s3Clients[tenantId]._config; }, 30 * 60 * 1000);
      return cfg;
    }
  } catch { /* fall through */ }

  // Fallback to env vars
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.S3_REGION,
    bucket: process.env.S3_BUCKET,
  };
}

function _getS3Client(s3Config) {
  const cacheKey = `${s3Config.accessKeyId}_${s3Config.region}`;
  if (_s3Clients[cacheKey]?.client) return _s3Clients[cacheKey].client;

  const client = new S3Client({
    region: s3Config.region,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    },
  });
  if (!_s3Clients[cacheKey]) _s3Clients[cacheKey] = {};
  _s3Clients[cacheKey].client = client;
  return client;
}

/* ───────── helpers ───────── */
const buildPublicUrl = (key, s3Config) =>
  `https://${s3Config.bucket}.s3.${s3Config.region}.amazonaws.com/${key}`;

const parseIntOrNull = (v) => {
  if (v === undefined || v === null || v === '' || v === 'undefined' || v === 'null') {
    return null;
  }
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

const isLockTimeoutError = (error) => {
  const code = error?.parent?.code || error?.original?.code || error?.code;
  return code === 'ER_LOCK_WAIT_TIMEOUT' || code === 'ER_LOCK_DEADLOCK';
};

const createArchivoWithRetry = async (db, data, options = {}, retries = 2) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await db.Archivo.create(data, options);
    } catch (error) {
      lastError = error;
      if (!isLockTimeoutError(error) || attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError;
};

/* ───────── CREATE genérico ───────── */
const saveFile = async (db, file, meta = {}, options = {}) => {
  const s3Config = await _loadTenantS3Config(db);
  let key;
  try {
    key = `${meta.prefix || 'general'}/${Date.now()}_${file.originalname}`;
    const s3Client = _getS3Client(s3Config);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Config.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
    return createArchivoWithRetry(db, {
      nombreOriginal: file.originalname,
      key,
      mimeType: file.mimetype,
      size: file.size,
      url: buildPublicUrl(key, s3Config),
      idProbeta: parseIntOrNull(meta.idProbeta),
      idEmpleado: parseIntOrNull(meta.idEmpleado),
      idObra: parseIntOrNull(meta.idObra),
      idPlanta: parseIntOrNull(meta.idPlanta),
      idVehiculo: parseIntOrNull(meta.idVehiculo),
      idPrensa: parseIntOrNull(meta.idPrensa),
      idRegistroCombustible: parseIntOrNull(meta.idRegistroCombustible),
      idFuenteCombustible: parseIntOrNull(meta.idFuenteCombustible),
      idFacturaVenta: parseIntOrNull(meta.idFacturaVenta),
      idFacturaCompra: parseIntOrNull(meta.idFacturaCompra),
      idPago: parseIntOrNull(meta.idPago),
      idOrdenVenta: parseIntOrNull(meta.idOrdenVenta),
      tipo: meta.tipo || 'documento',
    }, options);
  } catch (error) {
    console.log(error);
    throw error;
  }
};
const updateArchivo = async (db, id, data) => {
  const archivo = await db.Archivo.findByPk(id);
  if (!archivo) throw new Error('Archivo no encontrado');

  // Normalizamos las categorías recibidas
  let categorias = [];
  if (Array.isArray(data.categorias)) categorias = data.categorias;
  else if (data.idCategorias) categorias = data.idCategorias;
  else if (data.idCategoriaArchivo != null) categorias = [data.idCategoriaArchivo];

  categorias = categorias.map((c) =>
    typeof c === 'object' ? c.idCategoriaArchivo || c.id || c.value : c,
  ).filter((id) => id != null);

  if (categorias.length) {
    // Se eliminan las asociaciones actuales y se crean las nuevas
    await db.ArchivoCategoria.destroy({ where: { idArchivo: id } });
    const regs = categorias.map((idCategoriaArchivo) => ({
      idArchivo: id,
      idCategoriaArchivo,
    }));
    await db.ArchivoCategoria.bulkCreate(regs);
  }

  // Se devuelve el archivo con sus categorías actuales
  return await db.Archivo.findByPk(id, {
    include: [{ model: db.CategoriaArchivo, as: 'categorias' }],
  });
};
/* ───────── DELETE genérico ───────── */
const deleteArchivo = async (db, id) => {
  const archivo = await db.Archivo.findByPk(id);
  if (!archivo) return null;

  const s3Config = await _loadTenantS3Config(db);
  const s3Client = _getS3Client(s3Config);
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: s3Config.bucket,
      Key: archivo.key,
    }),
  );

  await archivo.destroy();
  return archivo;
};

async function uploadToS3Only(file, options = {}, db = null) {
  const s3Config = await _loadTenantS3Config(db);
  let key;

  key = `${options.prefix || 'general'}/${Date.now()}_${file.originalname}`;
  const s3Client = _getS3Client(s3Config);
  await s3Client.send(new PutObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  return {
    key,
    url: buildPublicUrl(key, s3Config)
  };
}
async function deleteFromKey(key, db = null) {
  const s3Config = await _loadTenantS3Config(db);
  const s3Client = _getS3Client(s3Config);
  await s3Client.send(new DeleteObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
  }));
}
function buildWhere(params = {}) {
  const where = {};
  if (params.probeta) where.idProbeta = params.probeta;
  if (params.idProbeta) where.idProbeta = params.idProbeta;
  if (params.empleado) where.idEmpleado = params.empleado;
  if (params.idEmpleado) where.idEmpleado = params.idEmpleado;
  if (params.equipo) where.idVehiculo = params.equipo;
  if (params.idVehiculo) where.idVehiculo = params.idVehiculo;
  if (params.obra) where.idObra = params.obra;
  if (params.idObra) where.idObra = params.idObra;
  if (params.planta) where.idPlanta = params.planta;
  if (params.idPlanta) where.idPlanta = params.idPlanta;
  if (params.prensa) where.idPrensa = params.prensa;
  if (params.idPrensa) where.idPrensa = params.idPrensa;
  if (params.idRegistroCombustible)
    where.idRegistroCombustible = params.idRegistroCombustible;
  if (params.fuente) where.idFuenteCombustible = params.fuente;
  if (params.idFuenteCombustible)
    where.idFuenteCombustible = params.idFuenteCombustible;

  return where;
}

/**
 * Devuelve un stream/buffer del archivo para servirlo como descarga.
 */
const getFileStream = async (key, db = null) => {
  const s3Config = await _loadTenantS3Config(db);
  const s3Client = _getS3Client(s3Config);
  const resp = await s3Client.send(new GetObjectCommand({ Bucket: s3Config.bucket, Key: key }));
  return resp.Body;
};

// [VITRINA] Include defensivo para Archivo: el modelo Vencimiento (módulo
// Flota/Mantenimiento) está recortado, así que su asociación 'vencimientos' no
// existe e incluirla rompe el findAll ("Include unexpected"). Construimos el
// include sólo con asociaciones registradas. En producción (todas presentes) es
// idéntico al include estático original.
const _archivoInclude = (db) => {
  const inc = [];
  if (db.Archivo.associations.categorias && db.CategoriaArchivo) inc.push({ model: db.CategoriaArchivo, as: 'categorias' });
  if (db.Archivo.associations.vencimientos && db.Vencimiento) inc.push({ model: db.Vencimiento, as: 'vencimientos' });
  return inc;
};

module.exports = {
  saveFile,
  deleteArchivo,
  deleteFromKey,
  uploadToS3Only,
  updateArchivo,
  getFileStream,
  getArchivos: (db, params = {}) =>
    db.Archivo.findAll({
      where: buildWhere(params),
      include: _archivoInclude(db),
    }),
  getArchivo: (db, id) =>
    db.Archivo.findByPk(id, {
      include: _archivoInclude(db),
    }),
  /* ───────── Categoría de archivo ───────── */
  createCategoria: (db, data) => db.CategoriaArchivo.create({
    categoria: data.categoria,
    tipo: data.tipo,
    orden: data.orden || 0,
    visibleEnPortal: !!data.visibleEnPortal,
  }),
  updateCategoria: async (db, id, data) => {
    const reg = await db.CategoriaArchivo.findByPk(id);
    if (!reg) throw new Error('CategoriaArchivo no encontrada');
    await reg.update({
      categoria: data.categoria !== undefined ? data.categoria : reg.categoria,
      tipo: data.tipo !== undefined ? data.tipo : reg.tipo,
      orden: data.orden !== undefined ? data.orden : reg.orden,
      visibleEnPortal: data.visibleEnPortal !== undefined ? !!data.visibleEnPortal : reg.visibleEnPortal,
    });
    return reg;
  },
  deleteCategoria: async (db, id) => {
    const reg = await db.CategoriaArchivo.findByPk(id);
    if (!reg) throw new Error('CategoriaArchivo no encontrada');
    await reg.destroy();
    return { message: 'Categoria eliminada' };
  },
  getCategorias: (db) =>
    db.CategoriaArchivo.findAll({ order: [['orden', 'ASC']] }),
};
