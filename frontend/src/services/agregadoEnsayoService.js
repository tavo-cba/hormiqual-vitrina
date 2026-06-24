import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
    ...config.headers,
    Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = `${config.backendUrl}/api/agregados-ensayos`;

// ─── Tipos ──────────────────────────────────────────────────

export const getTipos = async (params = {}) => {
    const { data } = await axios.get(`${BASE}/tipos`, { headers: getHeaders(), params });
    return data;
};

/**
 * List tipos with explicit named query params.
 * @param {{ material?: string, perfil?: string, includeHidden?: boolean, q?: string, includeDerivados?: boolean }} opts
 */
export const listTipos = async ({ material, perfil, includeHidden, q, includeDerivados } = {}) => {
    const params = {};
    if (material) params.material = material;
    if (perfil && perfil !== 'ALL') params.perfil = perfil;
    if (includeHidden) params.includeHidden = true;
    if (q) params.q = q;
    if (includeDerivados) params.includeDerivados = true;
    const { data } = await axios.get(`${BASE}/tipos`, { headers: getHeaders(), params });
    return data;
};

export const createTipo = async (body) => {
    const { data } = await axios.post(`${BASE}/tipos`, body, { headers: getHeaders() });
    return data;
};

export const updateTipo = async (id, body) => {
    const { data } = await axios.put(`${BASE}/tipos/${id}`, body, { headers: getHeaders() });
    return data;
};

/** PATCH a tipo — toggles like visibleEnCards, perfil, etc. */
export const patchTipo = async (id, body) => {
    const { data } = await axios.patch(`${BASE}/tipos/${id}`, body, { headers: getHeaders() });
    return data;
};

/** Soft-delete a tipo. */
export const deleteTipo = async (id, body = {}) => {
    const { data } = await axios.delete(`${BASE}/tipos/${id}`, { headers: getHeaders(), data: body });
    return data;
};

/** Apply a template (e.g. CORE_AGREGADOS) — upserts tipos. */
export const applyTemplate = async (body) => {
    const { data } = await axios.post(`${BASE}/tipos/apply-template`, body, { headers: getHeaders() });
    return data;
};

// ─── Ensayos ────────────────────────────────────────────────

export const getEnsayos = async (params = {}) => {
    const { data } = await axios.get(BASE, { headers: getHeaders(), params });
    return data;
};

export const getEnsayo = async (id) => {
    const { data } = await axios.get(`${BASE}/${id}`, { headers: getHeaders() });
    return data;
};

export const getUltimoPorTipo = async (legacyAgregadoId) => {
    const { data } = await axios.get(`${BASE}/ultimo-por-tipo/${legacyAgregadoId}`, { headers: getHeaders() });
    return data;
};

export const createEnsayo = async (body) => {
    const { data } = await axios.post(BASE, body, { headers: getHeaders() });
    return data;
};

export const createBatchEnsayos = async (body) => {
    const { data } = await axios.post(`${BASE}/batch`, body, { headers: getHeaders() });
    return data;
};

export const updateEnsayo = async (id, body) => {
    const { data } = await axios.put(`${BASE}/${id}`, body, { headers: getHeaders() });
    return data;
};

export const deleteEnsayo = async (id) => {
    const { data } = await axios.delete(`${BASE}/${id}`, { headers: getHeaders() });
    return data;
};

// ─── Resumen ────────────────────────────────────────────────

export const getResumen = async (legacyAgregadoId, params = {}) => {
    const { data } = await axios.get(`${BASE}/resumen/${legacyAgregadoId}`, { headers: getHeaders(), params });
    return data;
};

// ─── Ensayo counts / browse by tipo ─────────────────────────

/** Returns { [idAgregadoEnsayoTipo]: { total, activos } } */
export const getEnsayoCountsByTipo = async () => {
    const { data } = await axios.get(`${BASE}/tipos/counts`, { headers: getHeaders() });
    return data;
};

/** Returns ensayos for a specific tipo (for browsing). */
export const getEnsayosByTipo = async (idTipo, { includeInactive = false } = {}) => {
    const params = {};
    if (includeInactive) params.includeInactive = 'true';
    const { data } = await axios.get(`${BASE}/tipos/${idTipo}/ensayos`, { headers: getHeaders(), params });
    return data;
};

// ─── Evaluación granulometría ───────────────────────────────

export const evaluarGranulometria = async (body) => {
    const { data } = await axios.post(`${BASE}/granulometria/evaluar`, body, { headers: getHeaders() });
    return data;
};

export const evaluarBandaCompuesta = async (body) => {
    const { data } = await axios.post(`${BASE}/granulometria/evaluar-banda-compuesta`, body, { headers: getHeaders() });
    return data;
};

export const ajustarContraTeorica = async (body) => {
    const { data } = await axios.post(`${BASE}/granulometria/ajuste-teorico`, body, { headers: getHeaders() });
    return data;
};

// ─── Catálogo de curvas objetivo ────────────────────────────

const CURVAS_BASE = `${config.backendUrl}/api/curvas-granulometricas`;

export const getCurvasCatalogo = async (params = {}, { signal } = {}) => {
    const { data } = await axios.get(`${CURVAS_BASE}/catalogo`, { headers: getHeaders(), params, signal });
    return data;
};

export const getCurvaSerie = async (id) => {
    const { data } = await axios.get(`${CURVAS_BASE}/${id}/serie`, { headers: getHeaders() });
    return data;
};

// ─── Form Spec (formulario por tipo) ────────────────────────

const formSpecCache = {};

export const getFormSpec = async (codigo) => {
    if (formSpecCache[codigo]) return formSpecCache[codigo];
    const { data } = await axios.get(`${BASE}/form-spec/${encodeURIComponent(codigo)}`, { headers: getHeaders() });
    formSpecCache[codigo] = data;
    // Also cache under canonical
    if (data.canonicalCodigo && data.canonicalCodigo !== codigo) {
        formSpecCache[data.canonicalCodigo] = data;
    }
    return data;
};

// ─── Importación PDF (Claude) ───────────────────────────────

export const previewPdfImport = async (file, legacyAgregadoId, uso) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('legacyAgregadoId', legacyAgregadoId);
    if (uso) formData.append('uso', uso);

    const headers = getHeaders();
    delete headers['Content-Type']; // let browser set multipart boundary

    const { data } = await axios.post(`${BASE}/import/pdf`, formData, {
        headers,
        timeout: 120000, // long timeout for Claude processing
    });
    return data;
};

export const confirmPdfImport = async (body) => {
    const { data } = await axios.post(`${BASE}/import/pdf/confirm`, body, { headers: getHeaders() });
    return data;
};

// ─── Schema Keys (para wizard) ──────────────────────────────

export const getSchemaKeys = async () => {
    const { data } = await axios.get(`${BASE}/schema-keys`, { headers: getHeaders() });
    return data;
};

/** Get norma-based suggestion for wizard autocompletion. Returns null if 204. */
export const getSugerenciaPorNorma = async (material, normaCodigo) => {
    const resp = await axios.get(`${BASE}/tipos/sugerencia`, {
        headers: getHeaders(),
        params: { material, norma: normaCodigo },
    });
    if (resp.status === 204) return null;
    return resp.data;
};

// ─── AgregadoMeta (tipo agregado grueso, etc.) ──────────────

export const getAgregadoMeta = async (legacyAgregadoId) => {
    const { data } = await axios.get(`${BASE}/meta/${legacyAgregadoId}`, { headers: getHeaders() });
    return data;
};

// ─── Export / Import paquete de tipos ────────────────────────

export const exportEnsayosPaquete = async () => {
    const { data } = await axios.get(`${BASE}/tipos/export`, { headers: getHeaders() });
    return data;
};

export const previewImportEnsayos = async (paquete) => {
    const { data } = await axios.post(`${BASE}/tipos/import/preview`, paquete, { headers: getHeaders() });
    return data;
};

export const importEnsayosPaquete = async (ensayos, seleccionados) => {
    const { data } = await axios.post(`${BASE}/tipos/import`, { ensayos, seleccionados }, { headers: getHeaders() });
    return data;
};

// ─── Snapshots persistidos del catálogo ──────────────────────

export const listSnapshots = async ({ material } = {}) => {
    const params = {};
    if (material) params.material = material;
    const { data } = await axios.get(`${BASE}/snapshots`, { headers: getHeaders(), params });
    return data;
};

export const createSnapshot = async ({ nombre, descripcion, material }) => {
    const { data } = await axios.post(`${BASE}/snapshots`, { nombre, descripcion, material }, { headers: getHeaders() });
    return data;
};

export const deleteSnapshot = async (id) => {
    const { data } = await axios.delete(`${BASE}/snapshots/${id}`, { headers: getHeaders() });
    return data;
};

export const previewRestoreSnapshot = async (id) => {
    const { data } = await axios.get(`${BASE}/snapshots/${id}/preview`, { headers: getHeaders() });
    return data;
};

export const restoreSnapshot = async (id, seleccionados) => {
    const { data } = await axios.post(`${BASE}/snapshots/${id}/restore`, { seleccionados }, { headers: getHeaders() });
    return data;
};

export const upsertAgregadoMeta = async (legacyAgregadoId, body) => {
    const { data } = await axios.put(`${BASE}/meta/${legacyAgregadoId}`, body, { headers: getHeaders() });
    return data;
};

// ─── Caracterización (computed from ensayos) ────────────────

export const getCaracterizacion = async (legacyAgregadoId, uso = null) => {
    const params = uso ? { uso } : {};
    const { data } = await axios.get(`${BASE}/caracterizacion/${legacyAgregadoId}`, { headers: getHeaders(), params });
    return data;
};

/**
 * Fetch characterization for multiple aggregates in parallel.
 * Returns a Map<idAgregado, caracterizacion>.
 */
export const getCaracterizacionBulk = async (idAgregados) => {
    const results = await Promise.all(
        idAgregados.map(id => getCaracterizacion(id).catch(() => null))
    );
    const map = {};
    idAgregados.forEach((id, i) => { map[id] = results[i]; });
    return map;
};

// ─── PDF generation (individual + batch) ───────────────────────────────────

/**
 * Genera el PDF de un ensayo individual y dispara la descarga en el browser.
 *
 * @param {number} idAgregadoEnsayo
 * @param {Object} opciones - p/ granulometría: { contextos: ['HORMIGON'|'TBS'], idHusoDNV? }
 * @param {string} filename - nombre del archivo a descargar
 */
export const generarPdfEnsayo = async (idAgregadoEnsayo, opciones = {}, filename = null) => {
    const resp = await axios.post(
        `${BASE}/${idAgregadoEnsayo}/pdf`,
        opciones,
        { headers: getHeaders(), responseType: 'blob' },
    );
    const blob = new Blob([resp.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `ensayo-${idAgregadoEnsayo}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

/**
 * Genera un PDF batch con múltiples ensayos del mismo agregado.
 *
 * @param {number} idAgregado
 * @param {Array<{idAgregadoEnsayo, opciones?}>} ensayos
 * @param {string} filename
 */
export const generarPdfEnsayosBatch = async (idAgregado, ensayos, filename = null) => {
    const resp = await axios.post(
        `${BASE}/pdf-batch`,
        { idAgregado, ensayos },
        { headers: getHeaders(), responseType: 'blob' },
    );
    const blob = new Blob([resp.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `ensayos-agregado-${idAgregado}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
