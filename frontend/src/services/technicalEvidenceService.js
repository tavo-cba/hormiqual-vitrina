import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = () => `${config.backendUrl}/api/technical-evidence`;

export const listarEvidencias = async (params = {}) => {
  const { data } = await axios.get(BASE(), { headers: getHeaders(), params });
  return data?.items || [];
};

export const obtenerEvidencia = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

export const crearEvidencia = async (body) => {
  const { data } = await axios.post(BASE(), body, { headers: getHeaders() });
  return data;
};

export const actualizarEvidencia = async (id, body) => {
  const { data } = await axios.put(`${BASE()}/${id}`, body, { headers: getHeaders() });
  return data;
};

export const eliminarEvidencia = async (id) => {
  const { data } = await axios.delete(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};
