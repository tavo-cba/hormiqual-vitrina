'use strict';

/**
 * catalogoEnsayoSnapshotService.js
 *
 * Maneja snapshots persistidos del catálogo de tipos de ensayo
 * (`AgregadoEnsayoTipo`). La intención es darle al usuario una manera segura
 * de guardar su configuración (qué ensayos son obligatorios, en qué contexto
 * aplican, periodicidad, etc.) y restaurarla ante cambios indeseados.
 *
 * El payload del snapshot tiene el mismo shape que `/tipos/export` (paquete
 * v1): así, restaurar es exactamente reaplicar ese paquete con la misma
 * lógica que la importación JSON, evitando duplicar reglas.
 */

const VERSION_FORMATO = '1.0';

/**
 * Normaliza valores de campos antes de compararlos entre snapshot y catálogo
 * actual. Necesario porque MariaDB persiste booleans como TINYINT (0/1) y
 * Sequelize a veces los devuelve como número, otras como boolean. Sin esta
 * normalización, `String(true) !== String(1)` y un cambio se reportaría
 * como diferencia inexistente (o al revés).
 */
function _normalizarValor(v) {
    if (v == null || v === '') return '';
    if (v === true || v === 1 || v === '1') return 'true';
    if (v === false || v === 0 || v === '0') return 'false';
    return String(v).trim();
}

const _serializarTipo = (t) => {
    const plain = t.toJSON ? t.toJSON() : { ...t };
    return {
        codigo: plain.codigo,
        nombre: plain.nombre,
        schema_key: plain.schemaKey,
        norma_ref: plain.normaRef,
        material: plain.material,
        aplica_a: plain.aplicaA,
        categoria: plain.categoria,
        perfil: plain.perfil,
        obligatorio: !!plain.obligatorio,
        periodicidad_meses: plain.periodicidadMeses,
        warning_dias: plain.warningDays,
        orden: plain.orden,
        visible_ui: plain.visibleEnUI !== false,
        visible_cards: plain.visibleEnCards !== false,
        es_derivado: !!plain.esDerivado,
        derivado_de_codigo: plain.derivadoDeCodigo,
        derivado_clave: plain.derivadoClave,
        // PR1 multi-contexto:
        aplica_a_hormigon: plain.aplicaAHormigon,
        aplica_a_tbs: plain.aplicaATBS,
        obligatorio_hormigon: plain.obligatorioHormigon,
        obligatorio_tbs: plain.obligatorioTBS,
        nivel_caracterizacion_hormigon: plain.nivelCaracterizacionHormigon,
        nivel_caracterizacion_tbs: plain.nivelCaracterizacionTBS,
        _clave_unica: plain.codigo,
    };
};

/**
 * Construye el paquete actual del catálogo (mismo shape que /tipos/export).
 * Función pública para que el endpoint legacy también la use.
 */
const construirPaqueteActual = async (db, { material = 'AGREGADOS' } = {}) => {
    const tipos = await db.AgregadoEnsayoTipo.findAll({
        where: { isActive: true, material },
        order: [['orden', 'ASC'], ['nombre', 'ASC']],
    });
    return {
        tipo: 'ensayos',
        version_formato: VERSION_FORMATO,
        fecha_exportacion: new Date().toISOString(),
        material,
        cantidad: tipos.length,
        ensayos: tipos.map(_serializarTipo),
    };
};

/**
 * Crea un snapshot del catálogo actual.
 *
 * @param {object} db
 * @param {object} datos - { nombre, descripcion?, material? }
 * @param {object} [contexto] - { idEmpleado? }
 */
const crearSnapshot = async (db, datos = {}, contexto = {}) => {
    const nombre = (datos.nombre || '').trim();
    if (!nombre) {
        throw Object.assign(new Error('El snapshot necesita un nombre.'), { statusCode: 400 });
    }
    const material = datos.material || 'AGREGADOS';
    const paquete = await construirPaqueteActual(db, { material });
    const snapshot = await db.CatalogoEnsayoSnapshot.create({
        nombre,
        descripcion: datos.descripcion || null,
        material,
        cantidadEnsayos: paquete.cantidad,
        payload: paquete,
        idEmpleado: contexto.idEmpleado || null,
    });
    return snapshot.get({ plain: true });
};

/**
 * Lista los snapshots del catálogo (sin payload, para el listado liviano).
 */
const listarSnapshots = async (db, { material } = {}) => {
    const where = {};
    if (material) where.material = material;
    const rows = await db.CatalogoEnsayoSnapshot.findAll({
        where,
        attributes: ['idCatalogoEnsayoSnapshot', 'nombre', 'descripcion', 'material', 'cantidadEnsayos', 'idEmpleado', 'createdAt'],
        order: [['createdAt', 'DESC']],
    });
    return rows.map((r) => r.get({ plain: true }));
};

/**
 * Devuelve un snapshot completo (con payload).
 */
const obtenerSnapshot = async (db, id) => {
    const row = await db.CatalogoEnsayoSnapshot.findByPk(id);
    if (!row) return null;
    return row.get({ plain: true });
};

const eliminarSnapshot = async (db, id) => {
    const row = await db.CatalogoEnsayoSnapshot.findByPk(id);
    if (!row) {
        throw Object.assign(new Error('Snapshot no encontrado.'), { statusCode: 404 });
    }
    await row.destroy();
    return { ok: true };
};

/**
 * Genera un preview de qué cambia al restaurar un snapshot, comparando contra
 * el catálogo actual. Mismo shape que `/tipos/import/preview`, para reusar
 * el modal de diff del frontend.
 */
const previewRestauracion = async (db, id) => {
    const snap = await obtenerSnapshot(db, id);
    if (!snap) {
        throw Object.assign(new Error('Snapshot no encontrado.'), { statusCode: 404 });
    }
    // Defensivo: snapshots creados antes del getter del modelo pueden venir
    // como string JSON (LONGTEXT en MariaDB). El getter del modelo ya parsea,
    // pero por las dudas hacemos parse defensivo acá también.
    let paquete = snap.payload;
    if (typeof paquete === 'string') {
        try { paquete = JSON.parse(paquete); } catch { paquete = { ensayos: [] }; }
    }
    const existentes = await db.AgregadoEnsayoTipo.findAll();
    const existMap = {};
    const schemaKeys = new Set();
    for (const t of existentes) {
        const plain = t.toJSON ? t.toJSON() : { ...t };
        existMap[plain.codigo] = plain;
        if (plain.schemaKey) schemaKeys.add(plain.schemaKey);
    }
    // PR5-fix: incluir los campos multi-contexto que la UI moderna edita.
    // Antes solo comparábamos los flags legacy (`obligatorio`, `nombre`,
    // `perfil`, etc.), por eso un cambio en `obligatorioHormigon` o en los
    // chips multi-contexto no se detectaba al comparar contra el snapshot.
    const CAMPOS = [
        'nombre', 'perfil', 'obligatorio',
        'periodicidad_meses', 'warning_dias', 'orden',
        'visible_ui', 'visible_cards',
        // Multi-contexto (PR1)
        'aplica_a_hormigon', 'aplica_a_tbs',
        'obligatorio_hormigon', 'obligatorio_tbs',
        'nivel_caracterizacion_hormigon', 'nivel_caracterizacion_tbs',
    ];
    const CAMPO_MAP = {
        nombre: 'nombre',
        perfil: 'perfil',
        obligatorio: 'obligatorio',
        periodicidad_meses: 'periodicidadMeses',
        warning_dias: 'warningDays',
        orden: 'orden',
        visible_ui: 'visibleEnUI',
        visible_cards: 'visibleEnCards',
        aplica_a_hormigon: 'aplicaAHormigon',
        aplica_a_tbs: 'aplicaATBS',
        obligatorio_hormigon: 'obligatorioHormigon',
        obligatorio_tbs: 'obligatorioTBS',
        nivel_caracterizacion_hormigon: 'nivelCaracterizacionHormigon',
        nivel_caracterizacion_tbs: 'nivelCaracterizacionTBS',
    };
    let nNuevos = 0, nDifieren = 0, nIguales = 0;
    const preview = (paquete.ensayos || []).map((item) => {
        const codigo = item._clave_unica || item.codigo;
        const ex = existMap[codigo];
        const warnings = [];
        if (!ex) {
            nNuevos++;
            if (item.schema_key && !schemaKeys.has(item.schema_key)) {
                warnings.push(`Schema "${item.schema_key}" no existe en este ambiente.`);
            }
            return { codigo, nombre: item.nombre, estado: 'nuevo', diferencias: [], warnings, selected: true };
        }
        const diferencias = [];
        for (const campo of CAMPOS) {
            const dbCampo = CAMPO_MAP[campo];
            const valEx = _normalizarValor(ex[dbCampo]);
            const valIm = _normalizarValor(item[campo]);
            if (valEx !== valIm) {
                diferencias.push({ campo, antes: valEx || '(vacío)', despues: valIm || '(vacío)' });
            }
        }
        if (diferencias.length > 0) {
            nDifieren++;
            return { codigo, nombre: item.nombre, estado: 'difiere', diferencias, warnings, selected: true };
        }
        nIguales++;
        return { codigo, nombre: item.nombre, estado: 'igual', diferencias: [], warnings, selected: false };
    });
    return {
        snapshot: {
            idCatalogoEnsayoSnapshot: snap.idCatalogoEnsayoSnapshot,
            nombre: snap.nombre,
            material: snap.material,
            createdAt: snap.createdAt,
        },
        cantidad: preview.length,
        nuevos: nNuevos,
        difieren: nDifieren,
        iguales: nIguales,
        preview,
    };
};

/**
 * Aplica la restauración: para cada `codigo` seleccionado, sobrescribe los
 * campos editables del catálogo con los valores del snapshot. Mismo flujo
 * que el import JSON.
 */
const restaurarSnapshot = async (db, id, { seleccionados } = {}) => {
    const snap = await obtenerSnapshot(db, id);
    if (!snap) {
        throw Object.assign(new Error('Snapshot no encontrado.'), { statusCode: 404 });
    }
    // Defensivo: ver nota en previewRestauracion sobre snapshots viejos
    // persistidos como string.
    let payload = snap.payload;
    if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { payload = { ensayos: [] }; }
    }
    const items = (payload?.ensayos || []);
    const selectedSet = Array.isArray(seleccionados) ? new Set(seleccionados) : null;
    const resultados = { creados: 0, actualizados: 0, sin_cambios: 0, errores: [], detalle: [] };
    for (const item of items) {
        const codigo = item._clave_unica || item.codigo;
        if (selectedSet && !selectedSet.has(codigo)) {
            resultados.sin_cambios++;
            continue;
        }
        try {
            const existente = await db.AgregadoEnsayoTipo.findOne({ where: { codigo } });
            if (existente) {
                await existente.update({
                    nombre: item.nombre,
                    perfil: item.perfil || existente.perfil,
                    obligatorio: item.obligatorio !== undefined ? item.obligatorio : existente.obligatorio,
                    periodicidadMeses: item.periodicidad_meses !== undefined ? item.periodicidad_meses : existente.periodicidadMeses,
                    warningDays: item.warning_dias !== undefined ? item.warning_dias : existente.warningDays,
                    orden: item.orden !== undefined ? item.orden : existente.orden,
                    visibleEnUI: item.visible_ui !== undefined ? item.visible_ui : existente.visibleEnUI,
                    visibleEnCards: item.visible_cards !== undefined ? item.visible_cards : existente.visibleEnCards,
                    aplicaAHormigon: item.aplica_a_hormigon !== undefined ? item.aplica_a_hormigon : existente.aplicaAHormigon,
                    aplicaATBS: item.aplica_a_tbs !== undefined ? item.aplica_a_tbs : existente.aplicaATBS,
                    obligatorioHormigon: item.obligatorio_hormigon !== undefined ? item.obligatorio_hormigon : existente.obligatorioHormigon,
                    obligatorioTBS: item.obligatorio_tbs !== undefined ? item.obligatorio_tbs : existente.obligatorioTBS,
                    nivelCaracterizacionHormigon: item.nivel_caracterizacion_hormigon || existente.nivelCaracterizacionHormigon,
                    nivelCaracterizacionTBS: item.nivel_caracterizacion_tbs || existente.nivelCaracterizacionTBS,
                });
                resultados.actualizados++;
                resultados.detalle.push({ codigo, accion: 'actualizado' });
            } else {
                // M13 (auditoría 01-calidad): hacer explícito el default
                // permisivo `aplicaAHormigon = true` cuando el snapshot no
                // trae el campo. Snapshots pre-PR1 (multi-contexto) no tenían
                // `aplica_a_hormigon`/`aplica_a_tbs` y todo era hormigón por
                // definición. Mantenemos ese default por compat, pero lo
                // emitimos en `detalle` para que el caller (UI/log) sepa que
                // restauró un campo derivado, no leído del snapshot.
                const aplicaHormigonExplicito = item.aplica_a_hormigon != null;
                const aplicaHormigon = aplicaHormigonExplicito ? !!item.aplica_a_hormigon : true;
                await db.AgregadoEnsayoTipo.create({
                    codigo: item.codigo,
                    nombre: item.nombre,
                    schemaKey: item.schema_key || null,
                    normaRef: item.norma_ref || null,
                    material: item.material || snap.material || 'AGREGADOS',
                    aplicaA: item.aplica_a || null,
                    categoria: item.categoria || null,
                    perfil: item.perfil || 'AVANZADO',
                    obligatorio: !!item.obligatorio,
                    periodicidadMeses: item.periodicidad_meses || null,
                    warningDays: item.warning_dias || null,
                    orden: item.orden || 0,
                    visibleEnUI: item.visible_ui !== false,
                    visibleEnCards: item.visible_cards !== false,
                    esDerivado: !!item.es_derivado,
                    derivadoDeCodigo: item.derivado_de_codigo || null,
                    derivadoClave: item.derivado_clave || null,
                    isActive: true,
                    aplicaAHormigon: aplicaHormigon,
                    aplicaATBS: !!item.aplica_a_tbs,
                    obligatorioHormigon: !!item.obligatorio_hormigon,
                    obligatorioTBS: !!item.obligatorio_tbs,
                    nivelCaracterizacionHormigon: item.nivel_caracterizacion_hormigon || 'NINGUNA',
                    nivelCaracterizacionTBS: item.nivel_caracterizacion_tbs || 'NINGUNA',
                });
                resultados.creados++;
                resultados.detalle.push({
                    codigo,
                    accion: 'creado',
                    ...(aplicaHormigonExplicito ? {} : { aplica_a_hormigon_default: true }),
                });
            }
        } catch (err) {
            resultados.errores.push({ codigo, error: err.message });
        }
    }
    return resultados;
};

module.exports = {
    construirPaqueteActual,
    crearSnapshot,
    listarSnapshots,
    obtenerSnapshot,
    eliminarSnapshot,
    previewRestauracion,
    restaurarSnapshot,
    VERSION_FORMATO,
};
