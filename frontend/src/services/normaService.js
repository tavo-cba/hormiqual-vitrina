import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
    ...config.headers,
    Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = `${config.backendUrl}/api/normas`;

// ─── CRUD ───────────────────────────────────────────────────

export const getNormas = async (params = {}) => {
    const { data } = await axios.get(BASE, { headers: getHeaders(), params });
    return data;
};

export const getNorma = async (id) => {
    const { data } = await axios.get(`${BASE}/${id}`, { headers: getHeaders() });
    return data;
};

export const createNorma = async (body) => {
    const { data } = await axios.post(BASE, body, { headers: getHeaders() });
    return data;
};

export const updateNorma = async (id, body) => {
    const { data } = await axios.put(`${BASE}/${id}`, body, { headers: getHeaders() });
    return data;
};

export const deleteNorma = async (id) => {
    const { data } = await axios.delete(`${BASE}/${id}`, { headers: getHeaders() });
    return data;
};

// ─── File upload/download ───────────────────────────────────

export const uploadNormaPdf = async (normaId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await axios.post(`${BASE}/${normaId}/upload`, formData, {
        headers: { ...getHeaders(), 'Content-Type': 'multipart/form-data' },
    });
    return data;
};

export const getNormaDownloadUrl = (normaId) => `${BASE}/${normaId}/download`;

/**
 * Opens a norma PDF in a new browser tab using authenticated blob download.
 * Falls back to plain URL (for cases where auth might be cookie-based).
 */
export const openNormaPdf = async (normaId) => {
    try {
        const blob = await downloadNormaPdf(normaId);
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
        // Revoke after a delay so the browser has time to load
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch {
        // Fallback: direct URL (may fail if auth is required)
        window.open(getNormaDownloadUrl(normaId), '_blank');
    }
};

export const downloadNormaPdf = async (normaId) => {
    const response = await axios.get(`${BASE}/${normaId}/download`, {
        headers: getHeaders(),
        responseType: 'blob',
    });
    return response.data;
};

export const deleteNormaFile = async (normaId) => {
    const { data } = await axios.delete(`${BASE}/${normaId}/file`, { headers: getHeaders() });
    return data;
};

// ─── "Aplica a" options ──────────────────────────────────────

export const getAplicaAOptions = async () => {
    const { data } = await axios.get(`${BASE}/aplica-a`, { headers: getHeaders() });
    return data;
};

export const createAplicaAOption = async (body) => {
    const { data } = await axios.post(`${BASE}/aplica-a`, body, { headers: getHeaders() });
    return data;
};

// ─── Export / Import paquete ─────────────────────────────────

export const exportNormasPaquete = async () => {
    const { data } = await axios.get(`${BASE}/export`, { headers: getHeaders() });
    return data;
};

export const previewImportNormas = async (paquete) => {
    const { data } = await axios.post(`${BASE}/import/preview`, paquete, { headers: getHeaders() });
    return data;
};

export const importNormasPaquete = async (normas, seleccionados) => {
    const { data } = await axios.post(`${BASE}/import`, { normas, seleccionados }, { headers: getHeaders() });
    return data;
};
