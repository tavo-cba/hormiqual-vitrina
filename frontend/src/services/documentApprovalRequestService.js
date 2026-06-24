import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = () => `${config.backendUrl}/api/document-approvals`;

export const listarAprobaciones = async (params = {}) => {
  const { data } = await axios.get(BASE(), { headers: getHeaders(), params });
  return data?.items || [];
};

export const obtenerAprobacion = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

export const crearAprobacion = async (body) => {
  const { data } = await axios.post(BASE(), body, { headers: getHeaders() });
  return data;
};

export const aprobarCertificado = async (id, body = {}) => {
  const { data } = await axios.post(`${BASE()}/${id}/approve`, body, { headers: getHeaders() });
  return data;
};

export const rechazarCertificado = async (id, body = {}) => {
  const { data } = await axios.post(`${BASE()}/${id}/reject`, body, { headers: getHeaders() });
  return data;
};

export const registrarPdfEmitido = async (id) => {
  const { data } = await axios.post(`${BASE()}/${id}/pdf-issued`, {}, { headers: getHeaders() });
  return data;
};
