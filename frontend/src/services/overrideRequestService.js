import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = () => `${config.backendUrl}/api/override-requests`;

export const listarOverrides = async (params = {}) => {
  const { data } = await axios.get(BASE(), { headers: getHeaders(), params });
  return data;
};

export const obtenerOverride = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

export const crearOverride = async (body) => {
  const { data } = await axios.post(BASE(), body, { headers: getHeaders() });
  return data;
};

export const aprobarOverride = async (id, body = {}) => {
  const { data } = await axios.post(`${BASE()}/${id}/approve`, body, { headers: getHeaders() });
  return data;
};

export const rechazarOverride = async (id, body = {}) => {
  const { data } = await axios.post(`${BASE()}/${id}/reject`, body, { headers: getHeaders() });
  return data;
};

export const revocarOverride = async (id, body = {}) => {
  const { data } = await axios.post(`${BASE()}/${id}/revoke`, body, { headers: getHeaders() });
  return data;
};
