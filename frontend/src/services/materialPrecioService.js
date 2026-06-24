import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = () => `${config.backendUrl}/api/material-precios`;

/** Get all prices for a material */
export const getPrecios = async (source, sourceId) => {
  const { data } = await axios.get(`${BASE()}/${source}/${sourceId}`, { headers: getHeaders() });
  return data;
};

/** Get current vigente price for a material */
export const getPrecioVigente = async (source, sourceId) => {
  const { data } = await axios.get(`${BASE()}/${source}/${sourceId}/vigente`, { headers: getHeaders() });
  return data;
};

/** Get vigente prices for multiple materials at once */
export const getPreciosVigentesBulk = async (materiales) => {
  const { data } = await axios.post(`${BASE()}/vigentes-bulk`, { materiales }, { headers: getHeaders() });
  return data;
};

/** Create a new price */
export const createPrecio = async (body) => {
  const { data } = await axios.post(BASE(), body, { headers: getHeaders() });
  return data;
};

/** Update a price */
export const updatePrecio = async (id, body) => {
  const { data } = await axios.put(`${BASE()}/${id}`, body, { headers: getHeaders() });
  return data;
};

/** Delete a price */
export const deletePrecio = async (id) => {
  const { data } = await axios.delete(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

/** Bulk import prices */
export const importarPrecios = async (items) => {
  const { data } = await axios.post(`${BASE()}/importar`, { items }, { headers: getHeaders() });
  return data;
};
