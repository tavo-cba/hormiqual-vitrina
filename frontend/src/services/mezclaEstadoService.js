'use strict';

import axios from 'axios';
import { config } from '../config/config';

const BASE = () => `${config.backendUrl}/api/mezclas`;
const getHeaders = () => config.headers;

export const transicionarEstadoMezcla = async (idMezcla, { nuevoEstado, usuario, motivo, observaciones, metadata } = {}) => {
  const { data } = await axios.post(`${BASE()}/${idMezcla}/transicion`, { nuevoEstado, usuario, motivo, observaciones, metadata }, { headers: getHeaders() });
  return data;
};

export const crearNuevaVersionMezcla = async (idMezcla, { usuario, motivo } = {}) => {
  const { data } = await axios.post(`${BASE()}/${idMezcla}/nueva-version`, { usuario, motivo }, { headers: getHeaders() });
  return data;
};

export const obtenerVersionesMezcla = async (idMezcla) => {
  const { data } = await axios.get(`${BASE()}/${idMezcla}/versiones`, { headers: getHeaders() });
  return data;
};

export const obtenerHistorialMezcla = async (idMezcla) => {
  const { data } = await axios.get(`${BASE()}/${idMezcla}/historial`, { headers: getHeaders() });
  return data;
};

export const verificarIntegridadMezcla = async (idMezcla) => {
  const { data } = await axios.get(`${BASE()}/${idMezcla}/verificar-integridad`, { headers: getHeaders() });
  return data;
};
