import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = () => `${config.backendUrl}/api/curvas-cemento`;

export const getCurvasCemento = async ({ includeArchived = false, idPlanta = null } = {}) => {
  const params = {};
  if (includeArchived) params.includeArchived = true;
  if (idPlanta != null) params.idPlanta = idPlanta;
  const { data } = await axios.get(BASE(), { headers: getHeaders(), params });
  return data;
};

export const getCurvaCemento = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

export const createCurvaCemento = async (body) => {
  const { data } = await axios.post(BASE(), body, { headers: getHeaders() });
  return data;
};

export const updateCurvaCemento = async (id, body) => {
  const { data } = await axios.put(`${BASE()}/${id}`, body, { headers: getHeaders() });
  return data;
};

export const deleteCurvaCemento = async (id) => {
  const { data } = await axios.delete(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

export const analizarCurvaCementoPdf = async (file) => {
  const formData = new FormData();
  formData.append('pdf', file);
  const { data } = await axios.post(`${BASE()}/analizar-pdf`, formData, {
    headers: {
      ...getHeaders(),
      'Content-Type': 'multipart/form-data',
    },
  });
  return data;
};
