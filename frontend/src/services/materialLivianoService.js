/**
 * materialLivianoService.js — Sesión 2026-05-29 (Hormigón Alivianado).
 *
 * Cliente del CRUD de materiales livianos. Backend en `materialLivianoRoutes`.
 * Los materiales livianos viven en la tabla genérica `Material` filtrados por
 * `MaterialTipo = 'Liviano'`; el frontend nunca toca esa estructura — solo
 * consume este service.
 *
 * Shape del item devuelto:
 *   {
 *     idMaterial, id,
 *     nombre, proveedor, origen, observaciones,
 *     densidad, densidadKgM3,   // mismo valor, alias por compat
 *     activo, idMaterialTipo,
 *   }
 */
import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
    ...config.headers,
    Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = () => `${config.backendUrl}/api/materiales-livianos`;

export const listarMaterialesLivianos = async ({ includeArchived = false } = {}) => {
    const { data } = await axios.get(BASE(), {
        headers: getHeaders(),
        params: includeArchived ? { includeArchived: true } : {},
    });
    return Array.isArray(data?.materiales) ? data.materiales : [];
};

export const obtenerMaterialLiviano = async (id) => {
    const { data } = await axios.get(`${BASE()}/${id}`, { headers: getHeaders() });
    return data;
};

export const crearMaterialLiviano = async (payload) => {
    const { data } = await axios.post(BASE(), payload, { headers: getHeaders() });
    return data;
};

export const actualizarMaterialLiviano = async (id, payload) => {
    const { data } = await axios.put(`${BASE()}/${id}`, payload, { headers: getHeaders() });
    return data;
};

export const archivarMaterialLiviano = async (id) => {
    const { data } = await axios.delete(`${BASE()}/${id}`, { headers: getHeaders() });
    return data;
};
