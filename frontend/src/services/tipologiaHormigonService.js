import axios from 'axios';
import { config } from '../config/config';

const BASE = () => `${config.backendUrl}/api/tipologias-hormigon`;
const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

export const getTipologias = async () => {
  const { data } = await axios.get(BASE(), { headers: getHeaders() });
  return data;
};

export const getTipologiaPorCodigo = async (codigo) => {
  const { data } = await axios.get(`${BASE()}/codigo/${codigo}`, { headers: getHeaders() });
  return data;
};

export const getTipologia = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

export const crearTipologia = async (body) => {
  const { data } = await axios.post(BASE(), body, { headers: getHeaders() });
  return data;
};

export const actualizarTipologia = async (id, body) => {
  const { data } = await axios.put(`${BASE()}/${id}`, body, { headers: getHeaders() });
  return data;
};

export const eliminarTipologia = async (id) => {
  const { data } = await axios.delete(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

export const restaurarDefaultsTipologia = async (id) => {
  const { data } = await axios.post(`${BASE()}/${id}/restaurar-defaults`, {}, { headers: getHeaders() });
  return data;
};
