import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = () => `${config.backendUrl}/api/recetas-obra`;

/** Cálculo puro (sin persistir) */
export const calcularReceta = async (body) => {
  const { data } = await axios.post(`${BASE()}/calcular`, body, { headers: getHeaders() });
  return data;
};

/** Guardar receta de obra */
export const guardarReceta = async (body) => {
  const { data } = await axios.post(BASE(), body, { headers: getHeaders() });
  return data;
};

/** Listar recetas de una dosificación */
export const listarRecetas = async (dosificacionId) => {
  const { data } = await axios.get(`${BASE()}/dosificacion/${dosificacionId}`, { headers: getHeaders() });
  return data;
};

/** Obtener receta por ID */
export const obtenerReceta = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

/** Eliminar receta */
export const eliminarReceta = async (id) => {
  const { data } = await axios.delete(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

/** Últimas humedades de ensayo para los agregados de una dosificación */
export const obtenerUltimasHumedadesEnsayo = async (dosificacionId) => {
  const { data } = await axios.get(`${BASE()}/dosificacion/${dosificacionId}/humedades-ensayo`, { headers: getHeaders() });
  return data;
};
