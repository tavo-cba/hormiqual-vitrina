import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = `${config.backendUrl}/api/herramientas-calidad`;

export const listarClasesExposicion = async () => {
  const { data } = await axios.get(`${BASE}/clases-exposicion`, { headers: getHeaders() });
  return data;
};

export const listarTmnTabla43 = async () => {
  const { data } = await axios.get(`${BASE}/tmn-tabla-4-3`, { headers: getHeaders() });
  return data;
};

export const verificarTabla25 = async (payload) => {
  const { data } = await axios.post(`${BASE}/verificar-tabla-2-5`, payload, { headers: getHeaders() });
  return data;
};

export const verificarTabla43 = async (payload) => {
  const { data } = await axios.post(`${BASE}/verificar-tabla-4-3`, payload, { headers: getHeaders() });
  return data;
};

export const listarPulverulentoMinimo = async () => {
  const { data } = await axios.get(`${BASE}/pulverulento-minimo`, { headers: getHeaders() });
  return data;
};

export const verificarTabla44 = async (payload) => {
  const { data } = await axios.post(`${BASE}/verificar-tabla-4-4`, payload, { headers: getHeaders() });
  return data;
};

export const listarCurvasAC = async () => {
  const { data } = await axios.get(`${BASE}/curvas-ac`, { headers: getHeaders() });
  return data;
};

export const estimarACDesdeFc = async (payload) => {
  const { data } = await axios.post(`${BASE}/estimar-ac`, payload, { headers: getHeaders() });
  return data;
};
