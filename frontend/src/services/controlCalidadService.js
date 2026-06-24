import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = `${config.backendUrl}/api/control-calidad`;

export const getDashboard = async (params = {}) => {
  const { data } = await axios.get(`${BASE}/dashboard`, { headers: getHeaders(), params });
  return data;
};

export const getControlChart = async (params = {}) => {
  const { data } = await axios.get(`${BASE}/control-chart`, { headers: getHeaders(), params });
  return data;
};

export const getCusum = async (params = {}) => {
  const { data } = await axios.get(`${BASE}/cusum`, { headers: getHeaders(), params });
  return data;
};

export const getTiposHormigon = async () => {
  const { data } = await axios.get(`${BASE}/tipos-hormigon`, { headers: getHeaders() });
  return data;
};
