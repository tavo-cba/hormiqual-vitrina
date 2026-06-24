import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
    ...config.headers,
    Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = `${config.backendUrl}/api/husos-dnv`;

/**
 * Lista de husos DNV. Si tmnMm se provee, el backend filtra por cercanía
 * al TMN del agregado.
 *
 * @param {number} [tmnMm]
 * @returns {Promise<Array<{idHusoDNV, codigo, nombre, tipoTBS, capa, tmnMm, tablaPliego}>>}
 */
export const listHusosDnv = async (tmnMm = null) => {
    const params = {};
    if (tmnMm != null && !isNaN(Number(tmnMm))) params.tmnMm = Number(tmnMm);
    const { data } = await axios.get(BASE, { headers: getHeaders(), params });
    return data;
};

/**
 * Detalle de un huso DNV con sus puntos (abertura/designación + min/max %).
 *
 * @param {number} idHusoDNV
 * @returns {Promise<{idHusoDNV, codigo, nombre, tipoTBS, capa, tmnMm, tablaPliego, puntos: Array<{aberturaMm, designacion, pasaPctMin, pasaPctMax}>}>}
 */
export const getHusoDnv = async (idHusoDNV) => {
    const { data } = await axios.get(`${BASE}/${idHusoDNV}`, { headers: getHeaders() });
    return data;
};
