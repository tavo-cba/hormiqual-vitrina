import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
    ...config.headers,
    Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = `${config.backendUrl}/api/alertas-calidad`;

// ─── Listar alertas (con filtros) ─────────────────────────────
export const listarAlertas = async (params = {}) => {
    const { data } = await axios.get(BASE, { headers: getHeaders(), params });
    return data;
};

// ─── Contar pendientes (para badge) ───────────────────────────
export const contarPendientes = async (idPlanta) => {
    const params = {};
    if (idPlanta) params.idPlanta = idPlanta;
    const { data } = await axios.get(`${BASE}/pendientes/count`, { headers: getHeaders(), params });
    return data.count;
};

// ─── Marcar como leída ────────────────────────────────────────
export const marcarLeida = async (id, usuario) => {
    const { data } = await axios.post(`${BASE}/${id}/leer`, { usuario }, { headers: getHeaders() });
    return data;
};

// ─── Resolver ─────────────────────────────────────────────────
export const resolver = async (id, { usuario, notas }) => {
    const { data } = await axios.post(`${BASE}/${id}/resolver`, { usuario, notas }, { headers: getHeaders() });
    return data;
};

// ─── Ignorar ──────────────────────────────────────────────────
export const ignorar = async (id, usuario) => {
    const { data } = await axios.post(`${BASE}/${id}/ignorar`, { usuario }, { headers: getHeaders() });
    return data;
};

// ─── Verificar vencimientos manualmente ───────────────────────
export const verificarVencimientos = async () => {
    const { data } = await axios.post(`${BASE}/verificar-vencimientos`, {}, { headers: getHeaders() });
    return data;
};
