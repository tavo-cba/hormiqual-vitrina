import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = `${config.backendUrl}/api/laboratorios`;

export const listLaboratorios = async (params = {}) => {
  const { data } = await axios.get(BASE, { headers: getHeaders(), params });
  return data;
};

export const getLaboratorio = async (id) => {
  const { data } = await axios.get(`${BASE}/${id}`, { headers: getHeaders() });
  return data;
};

export const createLaboratorio = async (payload) => {
  const { data } = await axios.post(BASE, payload, { headers: getHeaders() });
  return data;
};

export const updateLaboratorio = async (id, payload) => {
  const { data } = await axios.put(`${BASE}/${id}`, payload, { headers: getHeaders() });
  return data;
};

export const deleteLaboratorio = async (id) => {
  const { data } = await axios.delete(`${BASE}/${id}`, { headers: getHeaders() });
  return data;
};
