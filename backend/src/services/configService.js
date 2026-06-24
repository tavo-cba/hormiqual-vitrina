const cacheManager = require('../cache/CacheManager');
const { extractTenantFromDb } = require('./cacheHelpers');

/** TTL para config: 1 hora (invalidado por hooks cuando cambia Config) */
const CONFIG_TTL = 3600;

const _getFullConfig = async (db) => {
    const tenant = extractTenantFromDb(db);
    const tc = cacheManager.forTenant(tenant);
    const cached = tc.get('config', 'fullConfig');
    if (cached) return cached;

    const config = await db.Config.findOne();
    if (config) {
        const plain = config.get({ plain: true });
        tc.set('config', 'fullConfig', plain, CONFIG_TTL);
        return plain;
    }
    return null;
};

const getConfig = async (db) => {
    const config = await _getFullConfig(db);
    if (!config) return { firmaEmpleadorBase64: null };
    const {
        nombreEmpresa, logoLink, logoKey, logoLightLink, logoLightKey,
        frontendUrl, thumbnail, direccionEmpresa, cuitEmpresa,
        firmaEmpleadorBase64, facturacionPuntoVenta, facturacionCbu,
        portalUrl, whatsappSoporte, modulosHabilitados, usaTBS,
        // P-V-03 (auditoría 08, Bloque 21): expuesta a la UI vía useConfig
        // para que los PDFs (certificadoIndividual, actaEnsayo) la lean.
        politicaUnidadCarga,
    } = config;
    return {
        nombreEmpresa, logoLink, logoKey, logoLightLink, logoLightKey,
        frontendUrl, thumbnail, direccionEmpresa, cuitEmpresa,
        firmaEmpleadorBase64, facturacionPuntoVenta, facturacionCbu,
        portalUrl, whatsappSoporte,
        modulosHabilitados: modulosHabilitados ? JSON.parse(modulosHabilitados) : null,
        usaTBS: !!usaTBS,
        politicaUnidadCarga: politicaUnidadCarga ?? 'ORIGINAL',
    };
};
const getProbetasConfig = async (db) => {
    const config = await _getFullConfig(db);
    if (!config) return null;
    const { probetaSerieUno, probetaSerieDos, probetaSerieTres, probetaSerieCuatro } = config;
    return { probetaSerieUno, probetaSerieDos, probetaSerieTres, probetaSerieCuatro };
};
const getAllConfig = async (db) => {
    return await _getFullConfig(db);
};

const getFacturacionConfig = async (db) => {
    const config = await _getFullConfig(db);
    if (!config) return {};
    const {
        facturacionRazonSocial, nombreEmpresa,
        facturacionCuit, cuitEmpresa,
        facturacionDomicilio, direccionEmpresa,
        facturacionPuntoVenta, facturacionCbu,
        retencionesGananciasActivo, retencionesIIBBActivo,
        retencionesIIBBProvincias, retencionesIIBBAlicuotaConvenio,
        retencionesIIBBAlicuotaSinConvenio, empresaConvenioMultilateral,
    } = config;
    return {
        facturacionRazonSocial, nombreEmpresa,
        facturacionCuit, cuitEmpresa,
        facturacionDomicilio, direccionEmpresa,
        facturacionPuntoVenta, facturacionCbu,
        retencionesGananciasActivo, retencionesIIBBActivo,
        retencionesIIBBProvincias, retencionesIIBBAlicuotaConvenio,
        retencionesIIBBAlicuotaSinConvenio, empresaConvenioMultilateral,
    };
};

const getPlanillaConfig = async (db) => {
    const config = await _getFullConfig(db);
    if (!config) return {};
    const {
        planillaHsEntradaObra, planillaHsSalidaObra, planillaPausaObra,
        planillaHsEntradaNoObra, planillaHsSalidaNoObra, planillaPausaNoObra,
        planillaActividad, planillaHorarioSabado, idPlanillaConvenio,
        facturacionRazonSocial, nombreEmpresa,
        facturacionCuit, cuitEmpresa,
        facturacionDomicilio, direccionEmpresa,
        firmaEmpleadorBase64,
    } = config;
    return {
        planillaHsEntradaObra, planillaHsSalidaObra, planillaPausaObra,
        planillaHsEntradaNoObra, planillaHsSalidaNoObra, planillaPausaNoObra,
        planillaActividad, planillaHorarioSabado, idPlanillaConvenio,
        facturacionRazonSocial, nombreEmpresa,
        facturacionCuit, cuitEmpresa,
        facturacionDomicilio, direccionEmpresa,
        firmaEmpleadorBase64,
    };
};

const getKeys = async (db) => {
    const config = await _getFullConfig(db);
    if (!config) return null;
    const { apiKeyMaps, apiGPTKey, claudeApiKey, geolockerApiKey, geolockerApiUrl } = config;
    return { apiKeyMaps, apiGPTKey, claudeApiKey, hasGeolocker: !!geolockerApiKey, geolockerApiUrl };
};

const getImapConfig = async (db) => {
    const config = await _getFullConfig(db);
    if (!config) return null;
    const { imapHost, imapPort, imapUser, imapPassword, imapTls, imapEnabled } = config;
    return { imapHost, imapPort, imapUser, imapPassword, imapTls, imapEnabled };
};

const getMailConfig = async (db) => {
    const config = await _getFullConfig(db);
    if (!config) return null;
    const { mailUser, mailPassword, mailHost, mailPort, thumbnail } = config;
    return { mailUser, mailPassword, mailHost, mailPort, thumbnail };
};

/**
 * Sprint 3 (sesión 2026-05-10) — campos cuyos cambios se auditan en
 * `ConfigChangeLog`. Append-only. Si se agregan campos sensibles
 * nuevos (ej. otros toggles de protocolo de calidad), sumarlos acá.
 */
const CAMPOS_AUDITADOS = Object.freeze([
    'aprobacionAutomaticaEnsayos',  // IRAM 1666 §A.7 segregación de funciones
]);

const _serializar = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return String(v); }
};

const updateConfig = async (db, data, ctx = {}) => {
    const { user, ip, motivo } = ctx;
    let config = await db.Config.findOne();

    // Snapshot del estado anterior (solo de los campos auditados que vienen
    // en el body) — antes de aplicar la mutación. Si el config no existía
    // todavía (primera ejecución), el "anterior" es null para todos.
    const cambios = [];
    if (db.ConfigChangeLog) {
        for (const campo of CAMPOS_AUDITADOS) {
            if (!Object.prototype.hasOwnProperty.call(data, campo)) continue;
            const anterior = config ? config[campo] : null;
            const nuevo = data[campo];
            // Solo auditar si efectivamente cambia.
            if (_serializar(anterior) !== _serializar(nuevo)) {
                cambios.push({ campo, anterior, nuevo });
            }
        }
    }

    if (!config) {
        config = await db.Config.create(data);
    } else {
        await config.update(data);
    }

    // Persistir auditoría (best-effort: si falla, NO revertimos la
    // operación de config — el cambio ya pasó, queremos saberlo).
    if (cambios.length > 0 && db.ConfigChangeLog) {
        const nombreEmpleado = user
            ? [user.apellido, user.nombre].filter(Boolean).join(', ') || user.username || null
            : null;
        const idEmpleado = user?.idEmpleado ?? null;
        for (const c of cambios) {
            try {
                await db.ConfigChangeLog.create({
                    campo: c.campo,
                    valorAnterior: _serializar(c.anterior),
                    valorNuevo:    _serializar(c.nuevo),
                    idEmpleado,
                    nombreEmpleado,
                    motivo: motivo || null,
                    ipOrigen: ip || null,
                    createdAt: new Date(),
                });
            } catch (err) {
                console.error('[configService] No se pudo registrar ConfigChangeLog:', err.message);
            }
        }
    }

    // El hook afterUpdate de Config invalida automaticamente el namespace 'config'
    return config;
};

module.exports = { getConfig, getMailConfig, updateConfig, getKeys, getAllConfig, getFacturacionConfig, getPlanillaConfig, getProbetasConfig, getImapConfig, CAMPOS_AUDITADOS };
