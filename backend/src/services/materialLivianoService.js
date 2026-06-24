'use strict';

/**
 * materialLivianoService — Sesión 2026-05-29 (Hormigón Alivianado).
 *
 * CRUD mínimo del catálogo de "materiales livianos" (telgopor en perlas,
 * EPS, perlita, arcilla expandida). Los livianos viven en la tabla genérica
 * `Material` filtrados por `MaterialTipo.nombre = 'Liviano'`. Eso les
 * permite usar la infraestructura ya existente (`MaterialPlanta` para
 * multi-planta, etc.) y los saca del flujo de `Agregado`, que exige
 * tipo Fino/Grueso, subtipo, tipo de roca y ensayos pétreos — todo lo cual
 * NO aplica a livianos manufacturados.
 *
 * Datos mínimos para un material liviano:
 *   - nombre (ej: "Telgopor en perlas")
 *   - proveedor (ej: "Knauf")
 *   - densidad declarada (kg/m³) — guardada en `densidadRelativa` × 1000
 *     no aplica acá: usamos `densidadRelativa` directo en kg/m³ porque
 *     livianos típicos van 10–800 kg/m³, no relativos al agua. Para evitar
 *     confusión, el JSON `metadataTecnicaJson` también guarda el campo
 *     `densidadKgM3` explícito (canónico para el motor).
 *
 * Pureza: este service toca DB, NO es engine puro. Vive en `services/`.
 */

const CATALOGO_TIPO_NOMBRE = 'Liviano';

/**
 * Resuelve el `idMaterialTipo` del tipo "Liviano". Soft-fail: si el modelo
 * no está registrado, la tabla no existe o el tipo todavía no se sembró
 * (migración pendiente), devuelve null sin tirar. Los callers de listar/
 * obtener lo interpretan como "lista vacía"; los de crear/actualizar
 * lanzan 500 con mensaje claro pidiendo correr la migración.
 */
async function _idTipoLiviano(db) {
    if (!db || !db.MaterialTipo) return null;
    try {
        const row = await db.MaterialTipo.findOne({
            where: { nombre: CATALOGO_TIPO_NOMBRE },
            attributes: ['idMaterialTipo'],
            raw: true,
        });
        return row ? row.idMaterialTipo : null;
    } catch (err) {
        // Tabla no existe / dialecto distinto / otro problema: log y null.
        console.warn('[materialLivianoService._idTipoLiviano] error consultando MaterialTipo:', err.message);
        return null;
    }
}

/**
 * Devuelve un material liviano serializado para el frontend.
 * El motor de cálculo lee `densidad` (kg/m³) y `id`/`nombre`.
 *
 * IMPORTANTE: la densidad se persiste exclusivamente en
 * `metadataTecnicaJson.densidadKgM3`. NO se usa el campo `densidadRelativa`
 * del modelo Material porque es DECIMAL(5,3) — rango 0–99,999 — que no
 * cubre densidades de arcilla expandida (~700 kg/m³) ni perlita (~150
 * kg/m³). Telgopor (14) sí entraría, pero por coherencia toda la familia
 * va por el JSON.
 */
function _serialize(row) {
    if (!row) return null;
    const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
    let meta = plain.metadataTecnicaJson || {};
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch { meta = {}; }
    }
    const densidadKgM3 = Number(meta.densidadKgM3) || null;
    return {
        idMaterial: plain.idMaterial,
        id: plain.idMaterial,
        nombre: plain.nombre,
        proveedor: plain.proveedor || null,
        origen: plain.origen || null,
        observaciones: plain.observaciones || null,
        densidad: densidadKgM3, // canónico kg/m³ para el motor
        densidadKgM3,
        activo: plain.activo !== false,
        idMaterialTipo: plain.idMaterialTipo,
    };
}

const listar = async (db, { includeArchived = false } = {}) => {
    if (!db || !db.Material) return [];
    try {
        const idTipo = await _idTipoLiviano(db);
        if (!idTipo) return [];
        const where = { idMaterialTipo: idTipo };
        if (!includeArchived) where.activo = true;
        const rows = await db.Material.findAll({
            where,
            order: [['nombre', 'ASC']],
        });
        return rows.map(_serialize);
    } catch (err) {
        console.warn('[materialLivianoService.listar] soft-fail:', err.message);
        return [];
    }
};

const obtener = async (db, idMaterial) => {
    if (!db.Material) return null;
    const idTipo = await _idTipoLiviano(db);
    if (!idTipo) return null;
    const row = await db.Material.findOne({
        where: { idMaterial: Number(idMaterial), idMaterialTipo: idTipo },
    });
    return _serialize(row);
};

const crear = async (db, data = {}) => {
    if (!db.Material) {
        throw Object.assign(new Error('Modelo Material no registrado en la conexión del tenant.'), { statusCode: 500 });
    }
    const idTipo = await _idTipoLiviano(db);
    if (!idTipo) {
        throw Object.assign(
            new Error('Falta el MaterialTipo "Liviano" en el catálogo. Corré la migración 20260529d-seed-material-tipo-liviano.'),
            { statusCode: 500 },
        );
    }
    _validarPayload(data);

    const densidadKgM3 = Number(data.densidadKgM3 || data.densidad);
    const created = await db.Material.create({
        idMaterialTipo: idTipo,
        nombre: String(data.nombre).trim(),
        proveedor: data.proveedor ? String(data.proveedor).trim() : null,
        origen: data.origen ? String(data.origen).trim() : null,
        observaciones: data.observaciones ? String(data.observaciones).trim() : null,
        densidadRelativa: null, // ver comentario en _serialize: usamos metadata JSON.
        metadataTecnicaJson: {
            densidadKgM3,
            unidad: 'kg/m3',
            ...(data.metadataTecnicaJson || {}),
        },
        activo: true,
    });
    return _serialize(created);
};

const actualizar = async (db, idMaterial, data = {}) => {
    if (!db.Material) return null;
    const idTipo = await _idTipoLiviano(db);
    if (!idTipo) return null;
    const row = await db.Material.findOne({
        where: { idMaterial: Number(idMaterial), idMaterialTipo: idTipo },
    });
    if (!row) return null;

    _validarPayload(data, { permitirCamposParciales: true });

    const updates = {};
    if (data.nombre !== undefined) updates.nombre = String(data.nombre).trim();
    if (data.proveedor !== undefined) updates.proveedor = data.proveedor ? String(data.proveedor).trim() : null;
    if (data.origen !== undefined) updates.origen = data.origen ? String(data.origen).trim() : null;
    if (data.observaciones !== undefined) updates.observaciones = data.observaciones ? String(data.observaciones).trim() : null;
    if (data.densidad !== undefined || data.densidadKgM3 !== undefined) {
        const densidadKgM3 = Number(data.densidadKgM3 || data.densidad);
        const metaActual = (() => {
            const m = row.metadataTecnicaJson;
            if (!m) return {};
            if (typeof m === 'string') { try { return JSON.parse(m); } catch { return {}; } }
            return m;
        })();
        updates.metadataTecnicaJson = {
            ...metaActual,
            densidadKgM3,
            unidad: 'kg/m3',
        };
    }
    if (data.activo !== undefined) updates.activo = data.activo === true;

    await row.update(updates);
    return _serialize(row);
};

const archivar = async (db, idMaterial) => {
    if (!db.Material) return null;
    const idTipo = await _idTipoLiviano(db);
    if (!idTipo) return null;
    const row = await db.Material.findOne({
        where: { idMaterial: Number(idMaterial), idMaterialTipo: idTipo },
    });
    if (!row) return null;
    await row.update({ activo: false });
    return _serialize(row);
};

/**
 * Validación de payload. Mínima: nombre y densidad son siempre obligatorios
 * al crear; en update pueden estar ausentes (parcial).
 */
function _validarPayload(data, { permitirCamposParciales = false } = {}) {
    const requireNombre = !permitirCamposParciales || data.nombre !== undefined;
    const requireDensidad = !permitirCamposParciales || data.densidad !== undefined || data.densidadKgM3 !== undefined;

    if (requireNombre && (!data.nombre || !String(data.nombre).trim())) {
        throw Object.assign(new Error('El campo "nombre" es obligatorio.'), { statusCode: 422 });
    }
    if (requireDensidad) {
        const densidadKgM3 = Number(data.densidadKgM3 || data.densidad);
        if (!Number.isFinite(densidadKgM3) || densidadKgM3 <= 0) {
            throw Object.assign(
                new Error('La densidad declarada (kg/m³) es obligatoria y debe ser > 0. Típico telgopor: 14 kg/m³.'),
                { statusCode: 422 },
            );
        }
        if (densidadKgM3 < 5 || densidadKgM3 > 1500) {
            throw Object.assign(
                new Error(`Densidad fuera de rango razonable para liviano (5–1500 kg/m³). Recibido: ${densidadKgM3} kg/m³.`),
                { statusCode: 422 },
            );
        }
    }
}

module.exports = {
    listar,
    obtener,
    crear,
    actualizar,
    archivar,
    // exports para tests / consumidores que necesiten el id del tipo
    _idTipoLiviano,
    _serialize,
};
