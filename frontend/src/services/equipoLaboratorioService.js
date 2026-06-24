import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = `${config.backendUrl}/api/equipos-laboratorio`;
const BASE_CAL = `${config.backendUrl}/api/calibraciones-equipo`;

/* ── Equipos ── */

export const listEquipos = async (params = {}) => {
  const { data } = await axios.get(BASE, { headers: getHeaders(), params });
  return data;
};

export const getEquipo = async (id) => {
  const { data } = await axios.get(`${BASE}/${id}`, { headers: getHeaders() });
  return data;
};

export const createEquipo = async (payload) => {
  const { data } = await axios.post(BASE, payload, { headers: getHeaders() });
  return data;
};

export const updateEquipo = async (id, payload) => {
  const { data } = await axios.put(`${BASE}/${id}`, payload, { headers: getHeaders() });
  return data;
};

export const deleteEquipo = async (id) => {
  const { data } = await axios.delete(`${BASE}/${id}`, { headers: getHeaders() });
  return data;
};

export const bulkAssignLab = async ({ idLaboratorio, idsEquipo }) => {
  const { data } = await axios.post(
    `${BASE}/bulk-assign-lab`,
    { idLaboratorio, idsEquipo },
    { headers: getHeaders() }
  );
  return data;
};

export const getTiposEquipo = async () => {
  const { data } = await axios.get(`${BASE}/tipos`, { headers: getHeaders() });
  return data;
};

/* ── Calibraciones ── */

export const listCalibraciones = async (params = {}) => {
  const { data } = await axios.get(BASE_CAL, { headers: getHeaders(), params });
  return data;
};

export const getCalibracion = async (id) => {
  const { data } = await axios.get(`${BASE_CAL}/${id}`, { headers: getHeaders() });
  return data;
};

export const createCalibracion = async (payload) => {
  const { data } = await axios.post(BASE_CAL, payload, { headers: getHeaders() });
  return data;
};

export const updateCalibracion = async (id, payload) => {
  const { data } = await axios.put(`${BASE_CAL}/${id}`, payload, { headers: getHeaders() });
  return data;
};

export const anularCalibracion = async (id) => {
  const { data } = await axios.delete(`${BASE_CAL}/${id}`, { headers: getHeaders() });
  return data;
};
