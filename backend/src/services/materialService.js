const { getCacheForDb } = require('./cacheHelpers');
const agregadoService = require('./agregadoService');
const cementoService  = require('./cementoService');
const aditivoService  = require('./aditivoService');
const fibraService    = require('./fibraService');

const CATALOGO_TTL = 3600;

/* ═══════════════════════════════════════════════════════════
   Tipos (sigue leyendo de MaterialTipo para las tabs)
   ═══════════════════════════════════════════════════════════ */
const getTipos = async (db) => {
  const tc = getCacheForDb(db);
  const cached = tc.get('catalogos', 'materialTipos');
  if (cached) return cached;

  const result = await db.MaterialTipo.findAll({
    where: { activo: true },
    order: [['orden', 'ASC']],
  });
  const plain = result.map(r => r.get({ plain: true }));
  tc.set('catalogos', 'materialTipos', plain, CATALOGO_TTL);
  return plain;
};

/* ═══════════════════════════════════════════════════════════
   Normalizers — convierten cada entidad legacy a un shape
   unificado { _source, _sourceId, _editRoute, nombre,
   proveedor, origen, tipo{...}, detalle }
   ═══════════════════════════════════════════════════════════ */

const TIPOS_MAP = {
  agregados: { idMaterialTipo: 1, nombre: 'Agregados',  icono: 'fa-solid fa-mountain' },
  cementos:  { idMaterialTipo: 2, nombre: 'Cementos',   icono: 'fa-solid fa-industry' },
  aditivos:  { idMaterialTipo: 3, nombre: 'Aditivos',   icono: 'fa-solid fa-flask' },
  adiciones: { idMaterialTipo: 4, nombre: 'Adiciones',  icono: 'fa-solid fa-gem' },
  fibras:    { idMaterialTipo: 5, nombre: 'Fibras',     icono: 'fa-solid fa-grip-lines' },
  agua:      { idMaterialTipo: 6, nombre: 'Agua',       icono: 'fa-solid fa-droplet' },
};

const normalizeAgregado = (a) => ({
  _source: 'agregado',
  _sourceId: a.idAgregado,
  // Sesión 2026-05-27 — rutas movidas a /calidad/catalogos/{tipo}/*.
  _editRoute: `/calidad/catalogos/agregados/editar/${a.tipoAgregado}/${a.idAgregado}`,
  nombre: a.nombre,
  proveedor: a.productor || null,
  origen: a.origen || null,
  tipo: TIPOS_MAP.agregados,
  detalle: `${a.tipoAgregado || ''} — densidad ${a.densidad ?? '-'}`,
  planta: a.planta || null,
  activo: a.activo !== false,
});

const normalizeCemento = (c) => ({
  _source: 'cemento',
  _sourceId: c.idCemento,
  _editRoute: `/calidad/catalogos/cementos/editar/${c.idCemento}`,
  nombre: c.nombreComercial,
  proveedor: c.fabricante || null,
  origen: c.origenFabrica || null,
  tipo: TIPOS_MAP.cementos,
  detalle: [c.composicion, c.resistencia ? `${c.resistencia} MPa` : null, c.propiedades].filter(Boolean).join(' — '),
  activo: c.activo !== false,
});

const normalizeAditivo = (a) => ({
  _source: 'aditivo',
  _sourceId: a.idAditivo,
  _editRoute: `/calidad/catalogos/aditivos/editar/${a.idAditivo}`,
  nombre: a.marca,
  proveedor: a.fabrica || null,
  origen: null,
  tipo: TIPOS_MAP.aditivos,
  detalle: a.funcion || '',
  activo: a.activo !== false,
});

const normalizeFibra = (f) => ({
  _source: 'fibra',
  _sourceId: f.idFibra,
  _editRoute: `/calidad/catalogos/fibras/editar/${f.idFibra}`,
  nombre: f.marca,
  proveedor: f.fabrica || null,
  origen: null,
  tipo: TIPOS_MAP.fibras,
  detalle: f.funcion || '',
  activo: f.activo !== false,
});

const normalizeAdicion = (m) => ({
  _source: 'adicion',
  _sourceId: m.idMaterial,
  _editRoute: null, // editable in-app
  nombre: m.nombre,
  proveedor: m.proveedor || null,
  origen: m.origen || null,
  tipo: TIPOS_MAP.adiciones,
  detalle: (m.propiedades || []).map(p => `${p.clave}: ${p.valor || ''} ${p.unidad || ''}`).join(', '),
  // carry extra data for adiciones CRUD
  idMaterial: m.idMaterial,
  idMaterialTipo: m.idMaterialTipo,
  fechaAlta: m.fechaAlta,
  observaciones: m.observaciones,
  propiedades: m.propiedades,
  activo: m.activo !== false,
});

const normalizeAgua = (a) => ({
  _source: 'agua',
  _sourceId: a.idAgua,
  _editRoute: null,
  nombre: a.nombre,
  proveedor: a.laboratorio || null,
  origen: a.fuenteOrigen || null,
  tipo: TIPOS_MAP.agua,
  detalle: a.observaciones || '',
  planta: a.planta || null,
  activo: a.activo !== false,
});

/* ═══════════════════════════════════════════════════════════
   Helpers para queries individuales (safe — nunca explotan)
   ═══════════════════════════════════════════════════════════ */
const fetchAgregados = async (db, { includeArchived = false } = {}) => {
  try {
    const items = await agregadoService.getAgregados(db, { includeArchived });
    return items.map(normalizeAgregado);
  } catch (err) {
    console.error('[materialService] Error al obtener Agregados:', err.message);
    return [];
  }
};

const fetchCementos = async (db, { includeArchived = false, idPlanta = null } = {}) => {
  try {
    const items = await cementoService.getCementos(db, { includeArchived, idPlanta });
    return items.map(normalizeCemento);
  } catch (err) {
    console.error('[materialService] Error al obtener Cementos:', err.message);
    return [];
  }
};

const fetchAditivos = async (db, { includeArchived = false, idPlanta = null } = {}) => {
  try {
    const items = await aditivoService.getAditivos(db, { includeArchived, idPlanta });
    return items.map(normalizeAditivo);
  } catch (err) {
    console.error('[materialService] Error al obtener Aditivos:', err.message);
    return [];
  }
};

const fetchAdiciones = async (db, { includeArchived = false, idPlanta = null } = {}) => {
  try {
    const where = { idMaterialTipo: 4 };
    if (!includeArchived) where.activo = true;

    if (idPlanta != null) {
      const mps = await db.MaterialPlanta.findAll({
        where: { materialSource: 'adicion', idPlanta: Number(idPlanta), activo: true },
        attributes: ['materialSourceId'],
        raw: true,
      });
      const ids = mps.map(m => m.materialSourceId);
      if (ids.length === 0) return [];
      where.idMaterial = ids;
    }

    const adiciones = await db.Material.findAll({
      where,
      include: [
        { model: db.MaterialPropiedad, as: 'propiedades', order: [['orden', 'ASC']] },
      ],
      order: [['nombre', 'ASC']],
    });
    return adiciones.map(r => normalizeAdicion(r.get({ plain: true })));
  } catch (err) {
    console.error('[materialService] Error al obtener Adiciones:', err.message);
    return [];
  }
};

const fetchFibras = async (db, { includeArchived = false, idPlanta = null } = {}) => {
  try {
    const items = await fibraService.getFibras(db, { includeArchived, idPlanta });
    return items.map(normalizeFibra);
  } catch (err) {
    console.error('[materialService] Error al obtener Fibras:', err.message);
    return [];
  }
};

// Sesión 2026-05-29 — Materiales livianos manufacturados (telgopor / EPS /
// perlita / arcilla expandida). Viven en `Material` con MaterialTipo
// 'Liviano'. Reusamos `materialLivianoService` que sabe filtrar por nombre
// del tipo (no hardcodea idMaterialTipo porque el seed lo asigna por
// AUTO_INCREMENT — varía entre tenants).
const fetchLivianos = async (db, { includeArchived = false } = {}) => {
  try {
    const materialLivianoService = require('./materialLivianoService');
    const items = await materialLivianoService.listar(db, { includeArchived });
    return items.map(normalizeLiviano);
  } catch (err) {
    console.error('[materialService] Error al obtener Livianos:', err.message);
    return [];
  }
};

const normalizeLiviano = (m) => ({
  _source: 'liviano',
  _sourceId: m.idMaterial,
  _editRoute: null, // editable in-app
  nombre: m.nombre,
  proveedor: m.proveedor || null,
  origen: m.origen || null,
  // El tab del frontend se identifica por `tipo.nombre`. Como el id del
  // MaterialTipo Liviano se asigna por AUTO_INCREMENT, no lo hardcodeamos:
  // el front filtra por nombre ('Liviano') que sí es estable.
  tipo: { nombre: 'Liviano', icono: 'fa-solid fa-circle-nodes' },
  detalle: m.densidad != null ? `${m.densidad} kg/m³` : '',
  idMaterial: m.idMaterial,
  idMaterialTipo: m.idMaterialTipo,
  densidad: m.densidad,
  observaciones: m.observaciones,
  activo: m.activo !== false,
});

const fetchAgua = async (db, { includeArchived = false } = {}) => {
  try {
    if (!db.Agua) return [];
    const where = includeArchived ? {} : { activo: true };
    const items = await db.Agua.findAll({
      where,
      include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'], required: false }],
      order: [['nombre', 'ASC']],
    });
    return items.map(r => normalizeAgua(r.get({ plain: true })));
  } catch (err) {
    console.error('[materialService] Error al obtener Agua:', err.message);
    return [];
  }
};

/* ═══════════════════════════════════════════════════════════
   getMateriales — agregador de todas las fuentes
   ═══════════════════════════════════════════════════════════ */
const getMateriales = async (db, { idMaterialTipo, returnMeta = false, includeArchived = false, idPlanta = null } = {}) => {
  const tipo = idMaterialTipo ? Number(idMaterialTipo) : null;
  const opts = { includeArchived, idPlanta };

  // ── Single-type query ─────────────────────────────────
  // Tipos 1-6 son históricos (id fijo). Liviano (sesión 2026-05-29) tiene
  // id por AUTO_INCREMENT — el caller debe pasar `idMaterialTipo` y
  // resolvemos el match por nombre del tipo si no encaja con 1-6.
  if (tipo) {
    let results = [];
    switch (tipo) {
      case 1: results = await fetchAgregados(db, opts);  break;
      case 2: results = await fetchCementos(db, opts);   break;
      case 3: results = await fetchAditivos(db, opts);   break;
      case 4: results = await fetchAdiciones(db, opts);  break;
      case 5: results = await fetchFibras(db, opts);     break;
      case 6: results = await fetchAgua(db, opts);       break;
      default: {
        // Resolver el nombre del MaterialTipo para el id pedido.
        if (db.MaterialTipo) {
          const t = await db.MaterialTipo.findByPk(tipo, { attributes: ['nombre'], raw: true });
          if (t && String(t.nombre).toLowerCase() === 'liviano') {
            results = await fetchLivianos(db, opts);
          }
        }
        break;
      }
    }
    results.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    return returnMeta ? { data: results, meta: null } : results;
  }

  // ── ALL types — run in parallel so one failure doesn't break others ──
  const [agregados, cementos, aditivos, adiciones, fibras, agua, livianos] = await Promise.all([
    fetchAgregados(db, opts),
    fetchCementos(db, opts),
    fetchAditivos(db, opts),
    fetchAdiciones(db, opts),
    fetchFibras(db, opts),
    fetchAgua(db, opts),
    fetchLivianos(db, opts),
  ]);

  const results = [...agregados, ...cementos, ...aditivos, ...adiciones, ...fibras, ...agua, ...livianos];
  results.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

  const meta = {
    counts: {
      agregados: agregados.length,
      cementos:  cementos.length,
      aditivos:  aditivos.length,
      adiciones: adiciones.length,
      fibras:    fibras.length,
      agua:      agua.length,
      livianos:  livianos.length,
      total:     results.length,
    },
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log('[materialService] ALL counts:', meta.counts);
  }

  return returnMeta ? { data: results, meta } : results;
};

/* ═══════════════════════════════════════════════════════════
   getMaterial — solo para adiciones (tipo 4 / Material table)
   ═══════════════════════════════════════════════════════════ */
const getMaterial = async (db, id) => {
  const row = await db.Material.findByPk(id, {
    include: [
      { model: db.MaterialTipo, as: 'tipo', attributes: ['idMaterialTipo', 'nombre', 'icono'] },
      { model: db.MaterialPropiedad, as: 'propiedades', order: [['orden', 'ASC']] },
    ],
  });
  if (!row) return null;
  const plain = row.get({ plain: true });

  // Plantas y precios solo para adiciones (tipo 4)
  if (Number(plain.idMaterialTipo) === 4) {
    try {
      const mps = await db.MaterialPlanta.findAll({
        where: { materialSource: 'adicion', materialSourceId: Number(id) },
        include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] }],
        order: [['idPlanta', 'ASC']],
      });
      plain.plantas = mps.map(m => m.get({ plain: true }));
      const idsPlanta = plain.plantas.map(p => p.idPlanta);
      if (idsPlanta.length > 0) {
        const { getPrecioVigenteBulkPorPlantas } = require('./materialPrecioService');
        const preciosMap = await getPrecioVigenteBulkPorPlantas(db, 'adicion', Number(id), idsPlanta);
        for (const p of plain.plantas) p.precioVigente = preciosMap[p.idPlanta] || null;
      }
    } catch (e) { console.warn('[getMaterial] plantas/precios skipped:', e.message); }
  }
  return plain;
};

/* ═══════════════════════════════════════════════════════════
   createMaterial / updateMaterial / deleteMaterial
   Solo aplican a Adiciones (tipo 4).
   ═══════════════════════════════════════════════════════════ */
const createMaterial = async (db, data) => {
  const t = await db.sequelize.transaction();
  try {
    const material = await db.Material.create({
      idMaterialTipo: data.idMaterialTipo,
      nombre: data.nombre,
      proveedor: data.proveedor || null,
      origen: data.origen || null,
      fechaAlta: data.fechaAlta || new Date(),
      observaciones: data.observaciones || null,
    }, { transaction: t });

    if (data.propiedades && data.propiedades.length > 0) {
      const props = data.propiedades.map((p, i) => ({
        idMaterial: material.idMaterial,
        clave: p.clave,
        valor: p.valor || null,
        unidad: p.unidad || null,
        orden: p.orden ?? i,
      }));
      await db.MaterialPropiedad.bulkCreate(props, { transaction: t });
    }

    await t.commit();

    // Sincronizar plantas (solo aplica a adiciones, tipo 4)
    if (Number(data.idMaterialTipo) === 4 && Array.isArray(data.plantasConfig)) {
      const matSvc = require('./materialPlantaService');
      await matSvc.sincronizarPlantas(db, 'adicion', material.idMaterial, data.plantasConfig);
    }

    return getMaterial(db, material.idMaterial);
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

const updateMaterial = async (db, id, data) => {
  const t = await db.sequelize.transaction();
  try {
    const material = await db.Material.findByPk(id);
    if (!material) throw new Error('Material no encontrado');

    await material.update({
      idMaterialTipo: data.idMaterialTipo,
      nombre: data.nombre,
      proveedor: data.proveedor || null,
      origen: data.origen || null,
      fechaAlta: data.fechaAlta || material.fechaAlta,
      observaciones: data.observaciones || null,
    }, { transaction: t });

    if (data.propiedades !== undefined) {
      await db.MaterialPropiedad.destroy({ where: { idMaterial: id }, transaction: t });
      if (data.propiedades && data.propiedades.length > 0) {
        const props = data.propiedades.map((p, i) => ({
          idMaterial: id,
          clave: p.clave,
          valor: p.valor || null,
          unidad: p.unidad || null,
          orden: p.orden ?? i,
        }));
        await db.MaterialPropiedad.bulkCreate(props, { transaction: t });
      }
    }

    await t.commit();

    if (Number(material.idMaterialTipo) === 4 && data.plantasConfig !== undefined) {
      const matSvc = require('./materialPlantaService');
      await matSvc.sincronizarPlantas(db, 'adicion', id, data.plantasConfig);
    }

    return getMaterial(db, id);
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

const deleteMaterial = async (db, id) => {
  const material = await db.Material.findByPk(id);
  if (!material) throw new Error('Material no encontrado');

  const refs = await Promise.all([
    db.MaterialPropiedad ? db.MaterialPropiedad.count({ where: { idMaterial: id } }) : 0,
  ]);
  const totalRefs = refs.reduce((a, b) => a + b, 0);

  if (totalRefs === 0) {
    await material.destroy();
    return { action: 'deleted', message: 'Material eliminado' };
  }

  await material.update({ activo: false });
  return { action: 'archived', message: 'Material archivado porque tiene referencias históricas' };
};

const restoreMaterial = async (db, source, sourceId) => {
  switch (source) {
    case 'agregado': return agregadoService.restoreAgregado(db, sourceId);
    case 'cemento':  return cementoService.restoreCemento(db, sourceId);
    case 'aditivo':  return aditivoService.restoreAditivo(db, sourceId);
    case 'fibra':    return fibraService.restoreFibra(db, sourceId);
    case 'adicion': {
      const mat = await db.Material.findByPk(sourceId);
      if (!mat) throw new Error('Material no encontrado');
      await mat.update({ activo: true });
      return { action: 'restored', message: 'Material restaurado' };
    }
    default: throw new Error('Tipo de material desconocido');
  }
};

module.exports = { getTipos, getMateriales, getMaterial, createMaterial, updateMaterial, deleteMaterial, restoreMaterial };
