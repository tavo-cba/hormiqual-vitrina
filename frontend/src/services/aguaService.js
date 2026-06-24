import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = () => `${config.backendUrl}/api/aguas`;

export const getAguas = async () => {
  const { data } = await axios.get(BASE(), { headers: getHeaders() });
  return data;
};

export const getAgua = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

export const createAgua = async (body) => {
  const { data } = await axios.post(BASE(), body, { headers: getHeaders() });
  return data;
};

export const updateAgua = async (id, body) => {
  const { data } = await axios.put(`${BASE()}/${id}`, body, { headers: getHeaders() });
  return data;
};

export const deleteAgua = async (id) => {
  const { data } = await axios.delete(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

export const restoreAgua = async (id) => {
  const { data } = await axios.post(`${BASE()}/restore`, { id }, { headers: getHeaders() });
  return data;
};
