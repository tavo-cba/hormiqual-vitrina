import axios from 'axios';
import { config } from '../config/config';

const getHeaders = () => ({
  ...config.headers,
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const BASE = () => `${config.backendUrl}/api/dosificaciones-diseno`;

/* ═══ Curvas Agua-Asentamiento ═══ */
export const getCurvasAguaAsentamiento = async () => {
  const { data } = await axios.get(`${BASE()}/curvas/agua-asentamiento`, { headers: getHeaders() });
  return data;
};
export const createCurvaAguaAsentamiento = async (body) => {
  const { data } = await axios.post(`${BASE()}/curvas/agua-asentamiento`, body, { headers: getHeaders() });
  return data;
};
export const updateCurvaAguaAsentamiento = async (id, body) => {
  const { data } = await axios.put(`${BASE()}/curvas/agua-asentamiento/${id}`, body, { headers: getHeaders() });
  return data;
};
export const deleteCurvaAguaAsentamiento = async (id) => {
  const { data } = await axios.delete(`${BASE()}/curvas/agua-asentamiento/${id}`, { headers: getHeaders() });
  return data;
};

/* ═══ Curvas A/C-Resistencia ═══ */
export const getCurvasACResistencia = async () => {
  const { data } = await axios.get(`${BASE()}/curvas/ac-resistencia`, { headers: getHeaders() });
  return data;
};
export const createCurvaACResistencia = async (body) => {
  const { data } = await axios.post(`${BASE()}/curvas/ac-resistencia`, body, { headers: getHeaders() });
  return data;
};
export const updateCurvaACResistencia = async (id, body) => {
  const { data } = await axios.put(`${BASE()}/curvas/ac-resistencia/${id}`, body, { headers: getHeaders() });
  return data;
};
export const deleteCurvaACResistencia = async (id) => {
  const { data } = await axios.delete(`${BASE()}/curvas/ac-resistencia/${id}`, { headers: getHeaders() });
  return data;
};

/* ═══ Factor de ajuste ICPA por familia ═══ */
export const getFactorAjusteFamilia = async (familia) => {
  const { data } = await axios.get(`${BASE()}/curvas/ac-resistencia/factor-ajuste/${familia}`, { headers: getHeaders() });
  return data;
};
export const updateFactorAjusteFamilia = async (familia, factorAjuste) => {
  const { data } = await axios.put(`${BASE()}/curvas/ac-resistencia/factor-ajuste/${familia}`, { factorAjuste }, { headers: getHeaders() });
  return data;
};

/* ═══ Aire esperado ═══ */
export const getAireEsperado = async () => {
  const { data } = await axios.get(`${BASE()}/curvas/aire-esperado`, { headers: getHeaders() });
  return data;
};

/* ═══ Ábaco 1 ICPA — agua base f(asentamiento, MF) ═══ */
export const getAbacoCurvaICPA = async () => {
  const { data } = await axios.get(`${BASE()}/curvas/abaco-icpa`, { headers: getHeaders() });
  return data;
};
export const createAbacoCurvaICPA = async (body) => {
  const { data } = await axios.post(`${BASE()}/curvas/abaco-icpa`, body, { headers: getHeaders() });
  return data;
};
export const updateAbacoCurvaICPA = async (id, body) => {
  const { data } = await axios.put(`${BASE()}/curvas/abaco-icpa/${id}`, body, { headers: getHeaders() });
  return data;
};
export const deleteAbacoCurvaICPA = async (id) => {
  const { data } = await axios.delete(`${BASE()}/curvas/abaco-icpa/${id}`, { headers: getHeaders() });
  return data;
};
export const restoreAbacoCurvaICPADefaults = async () => {
  const { data } = await axios.post(`${BASE()}/curvas/abaco-icpa/restore-defaults`, {}, { headers: getHeaders() });
  return data;
};

// CorrectoresICPA: feature deprecada (pestaña UI eliminada). El motor ya no
// los aplica (migración 20260315 desactivó TMN/FORMA legacy; AIRE reservado
// para futuro). El endpoint backend `/curvas/correctores-icpa` sigue accesible
// para diagnóstico, pero no hay caller en el frontend, por lo que el wrapper
// se quitó de este service.

/* ═══ Durabilidad por exposición (ICPA) ═══ */
export const getDurabilidadExposicion = async () => {
  const { data } = await axios.get(`${BASE()}/curvas/durabilidad-exposicion`, { headers: getHeaders() });
  return data;
};

/* ═══ Consistencia — Tablas 4.1/4.2 CIRSOC 200:2024 (read-only) ═══ */
export const getConsistenciaClases = async () => {
  const { data } = await axios.get(`${BASE()}/curvas/consistencia`, { headers: getHeaders() });
  return data;
};

/* ═══ Aire durabilidad — Tabla 4.3 CIRSOC 200:2024 (read-only) ═══ */
export const getAireDurabilidad = async () => {
  const { data } = await axios.get(`${BASE()}/curvas/aire-durabilidad`, { headers: getHeaders() });
  return data;
};

/* ═══ Pulverulento mínimo — Tabla 4.4 CIRSOC 200:2024 (read-only) ═══ */
export const getPulverulentoMinimo = async () => {
  const { data } = await axios.get(`${BASE()}/curvas/pulverulento-minimo`, { headers: getHeaders() });
  return data;
};

/* ═══ Hormigones con características particulares — Tabla 9.3 CIRSOC 200:2024 (read-only) ═══ */
export const getHormigonParticular = async (tipoHormigon) => {
  const qs = tipoHormigon ? `?tipoHormigon=${encodeURIComponent(tipoHormigon)}` : '';
  const { data } = await axios.get(`${BASE()}/curvas/hormigon-particular${qs}`, { headers: getHeaders() });
  return data;
};

/* ═══ Fibras (catálogo) ═══ */
export const listarFibras = async (idPlanta = null) => {
  const params = idPlanta != null ? { idPlanta } : {};
  const { data } = await axios.get(`${config.backendUrl}/api/fibras`, { headers: getHeaders(), params });
  return data;
};

/* ═══ Cálculo ═══ */
export const calcularDosificacion = async (body) => {
  const { data } = await axios.post(`${BASE()}/calcular`, body, { headers: getHeaders() });
  return data;
};

/* ═══ CRUD diseños ═══ */
export const getDosificaciones = async (params = {}) => {
  const { data } = await axios.get(BASE(), { headers: getHeaders(), params });
  return data;
};
export const getDosificacion = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};
export const guardarDosificacion = async (body) => {
  const { data } = await axios.post(BASE(), body, { headers: getHeaders() });
  return data;
};
export const eliminarDosificacion = async (id) => {
  const { data } = await axios.delete(`${BASE()}/${id}`, { headers: getHeaders() });
  return data;
};

/* ═══ Estado transitions & versioning ═══ */

export const transicionarEstado = async (id, { nuevoEstado, usuario, motivo, observaciones, metadata } = {}) => {
  const { data } = await axios.post(`${BASE()}/${id}/transicion`, { nuevoEstado, usuario, motivo, observaciones, metadata }, { headers: getHeaders() });
  return data;
};

/* ═══ Pendientes de revisión (asignadas al usuario logueado) ═══
   Backend filtra por revisorAsignado = user (username o displayName). */
export const listarPendientesRevisionMias = async () => {
  const { data } = await axios.get(`${BASE()}/pendientes-revision/mias`, { headers: getHeaders() });
  return Array.isArray(data?.dosificaciones) ? data.dosificaciones : [];
};

/* ═══ Modificar proporciones de la mezcla de un diseño (Issue 2 — sesión 2026-05-27) ═══
   Solo BORRADOR. El backend decide inplace (mezcla exclusiva) vs fork (compartida)
   y devuelve { idMezcla, modo: 'inplace'|'fork', mezcla }.
   Para diseños YA guardados como dosi (loadedDosif.id presente). */
export const modificarProporcionesMezcla = async (idDosi, proporciones) => {
  const { data } = await axios.put(
    `${BASE()}/${idDosi}/mezcla/proporciones`,
    { proporciones },
    { headers: getHeaders() },
  );
  return data;
};

/* Variante para diseños NO guardados todavía: opera sobre el idMezcla
   directamente. El backend cuenta TODAS las dosis activas que la referencien
   para decidir inplace/fork. En fork, el frontend hace setField('mezclaId', …).
   Permite modificar proporciones desde el diseñador sin haber guardado el
   borrador previamente. */
export const modificarProporcionesMezclaPorId = async (idMezcla, proporciones) => {
  const { data } = await axios.put(
    `${BASE()}/proporciones-mezcla/${idMezcla}`,
    { proporciones },
    { headers: getHeaders() },
  );
  return data;
};

/* Fase 3 — listar usuarios autorizados a firmar override de pastón. */
export const listarFirmantesOverride = async () => {
  const { data } = await axios.get(`${BASE()}/firmantes-override`, { headers: getHeaders() });
  return data?.firmantes || [];
};

/* PR7 — listar usuarios disponibles para asignar como revisor (BORRADOR →
 * PENDIENTE_REVISION). Mismos roles que firmantes-override pero endpoint con
 * nombre semánticamente correcto. */
export const listarRevisoresDisponibles = async () => {
  const { data } = await axios.get(`${BASE()}/revisores-disponibles`, { headers: getHeaders() });
  return data?.revisores || [];
};

/* PR11 — Dashboard global de pastones del tenant. Filtros opcionales:
 *   { estado, veredicto, desde, hasta, idPlanta, limit }
 */
export const listarPastonesGlobal = async (filtros = {}) => {
  const { data } = await axios.get(`${BASE()}/pastones-global`, {
    headers: getHeaders(),
    params: filtros,
  });
  return data || [];
};

/* PR12 — Generar probetas para un pastón. Body opcional:
 *   { diasRotura: [7, 28], cantidadPorDia: 3 }
 * Idempotente: si el pastón ya tiene probetas para el día X, no las duplica.
 */
export const generarProbetasDesdePaston = async (idPaston, body = {}) => {
  const { data } = await axios.post(`${BASE()}/pastones/${idPaston}/probetas`, body, { headers: getHeaders() });
  return data;
};
export const crearNuevaVersion = async (id, { usuario, motivo } = {}) => {
  const { data } = await axios.post(`${BASE()}/${id}/nueva-version`, { usuario, motivo }, { headers: getHeaders() });
  return data;
};
export const enviarNuevaRondaPrueba = async (id, { motivo } = {}) => {
  const { data } = await axios.post(`${BASE()}/${id}/nueva-ronda-prueba`, { motivo }, { headers: getHeaders() });
  return data;
};
export const obtenerVersiones = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}/versiones`, { headers: getHeaders() });
  return data;
};
/**
 * Devuelve el historial enriquecido. Fase 4.2: el backend devuelve
 * `{ eventos, resumen }`. Por backward-compat con callers que esperan un
 * array, este helper también acepta el shape legacy y devuelve el array
 * de eventos en `eventos`. Para acceder al resumen agregado usar
 * `obtenerHistorialEnriquecido`.
 */
export const obtenerHistorial = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}/historial`, { headers: getHeaders() });
  if (Array.isArray(data)) return data; // fallback al shape viejo
  return data?.eventos || [];
};

/**
 * Versión completa del endpoint con resumen agregado (Fase 4.2).
 * Devuelve `{ eventos, resumen: { total, porCategoria, destacados, ... } }`.
 */
export const obtenerHistorialEnriquecido = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}/historial`, { headers: getHeaders() });
  if (Array.isArray(data)) return { eventos: data, resumen: null };
  return data;
};
export const verificarIntegridad = async (id) => {
  const { data } = await axios.get(`${BASE()}/${id}/verificar-integridad`, { headers: getHeaders() });
  return data;
};

/* ═══ Resultados de producción (FUNC-05) ═══ */

export const obtenerResultadosProduccion = async (id, { edadDias } = {}) => {
  const params = {};
  if (edadDias) params.edadDias = edadDias;
  const { data } = await axios.get(`${BASE()}/${id}/resultados-produccion`, { headers: getHeaders(), params });
  return data;
};

/* ═══ Legacy dosificaciones (catálogo) ═══ */

export const getDosificacionesCatalogo = async () => {
  const { data } = await axios.get(`${config.backendUrl}/api/dosificaciones`, { headers: getHeaders() });
  return data;
};

export const vincularCatalogo = async (id, idDosificacionCatalogo) => {
  const { data } = await axios.put(`${BASE()}/${id}/vincular-catalogo`, { idDosificacionCatalogo }, { headers: getHeaders() });
  return data;
};

/* ═══ Helpers — materiales para selectores ═══ */

export const getCementos = async (idPlanta = null) => {
  const params = idPlanta != null ? { idPlanta } : {};
  const { data } = await axios.get(`${config.backendUrl}/api/cementos`, { headers: getHeaders(), params });
  return data;
};
export const getAdiciones = async (idPlanta = null) => {
  // Adiciones are Material records with idMaterialTipo=4
  const params = { tipo: 4 };
  if (idPlanta != null) params.idPlanta = idPlanta;
  const { data } = await axios.get(`${config.backendUrl}/api/materiales`, { headers: getHeaders(), params });
  return data;
};
export const getAditivos = async (idPlanta = null) => {
  const params = idPlanta != null ? { idPlanta } : {};
  const { data } = await axios.get(`${config.backendUrl}/api/aditivos`, { headers: getHeaders(), params });
  return data;
};

export const getMezclas = async (plantaId) => {
  const { data } = await axios.get(`${config.backendUrl}/api/mezclas`, {
    headers: getHeaders(),
    params: { plantaId, activo: true },
  });
  return data;
};

export const getMezcla = async (id) => {
  const { data } = await axios.get(`${config.backendUrl}/api/mezclas/${id}`, {
    headers: getHeaders(),
  });
  return data;
};

export const getPlantas = async () => {
  const { data } = await axios.get(`${config.backendUrl}/api/plantas`, { headers: getHeaders() });
  return data;
};

/* ═══ Factores de edad β(t) ═══ */
export const getFactoresEdad = async () => {
  const { data } = await axios.get(`${BASE()}/curvas/factores-edad`, { headers: getHeaders() });
  return data;
};

/* ═══ Mediciones seriadas de pastón (Fase 2B — slump loss) ═══ */
export const listarMedicionesPaston = async (idPaston) => {
  const { data } = await axios.get(`${BASE()}/pastones/${idPaston}/mediciones`, { headers: getHeaders() });
  return data.mediciones || [];
};
/* MuestraPaston: cada pastón puede tener 1-2 muestras (PLANTA / OBRA),
   y cada muestra agrupa las probetas físicas moldeadas para rotura. Se
   usa en el informe del pastón para detallar las probetas asociadas. */
export const listarMuestrasDePaston = async (idPaston) => {
  const { data } = await axios.get(
    `${config.backendUrl}/api/muestras-pastones`,
    { params: { idPastonPrueba: idPaston }, headers: getHeaders() },
  );
  return Array.isArray(data) ? data : [];
};
export const crearMedicionPaston = async (idPaston, body) => {
  const { data } = await axios.post(`${BASE()}/pastones/${idPaston}/mediciones`, body, { headers: getHeaders() });
  return data;
};
export const actualizarMedicionPaston = async (idMed, body) => {
  const { data } = await axios.put(`${BASE()}/pastones/mediciones/${idMed}`, body, { headers: getHeaders() });
  return data;
};
export const eliminarMedicionPaston = async (idMed) => {
  const { data } = await axios.delete(`${BASE()}/pastones/mediciones/${idMed}`, { headers: getHeaders() });
  return data;
};

/* ═══ Análisis de eficiencia por pastón ═══ */
export const obtenerAnalisisEficiencia = async (idPaston) => {
  const { data } = await axios.get(`${BASE()}/pastones/${idPaston}/analisis-eficiencia`, { headers: getHeaders() });
  return data;
};

/* ═══ Predicción de comportamiento fresco (V1 heurística) ═══ */
export const obtenerPrediccionFresco = async (idDosif) => {
  const { data } = await axios.get(`${BASE()}/${idDosif}/prediccion-fresco`, { headers: getHeaders() });
  return data;
};
export const guardarPrediccionFresco = async (idDosif, prediccion) => {
  const { data } = await axios.post(`${BASE()}/${idDosif}/prediccion-fresco`, prediccion, { headers: getHeaders() });
  return data;
};

/* ═══ Redosificaciones en obra (acciones trazables post-diseño) ═══ */
export const listarRedosificaciones = async (idDosif) => {
  const { data } = await axios.get(`${BASE()}/${idDosif}/redosificaciones`, { headers: getHeaders() });
  return data.redosificaciones || [];
};
export const crearRedosificacion = async (idDosif, body) => {
  const { data } = await axios.post(`${BASE()}/${idDosif}/redosificaciones`, body, { headers: getHeaders() });
  return data;
};
export const actualizarRedosificacion = async (idRedos, body) => {
  const { data } = await axios.put(`${BASE()}/redosificaciones/${idRedos}`, body, { headers: getHeaders() });
  return data;
};
export const eliminarRedosificacion = async (idRedos) => {
  const { data } = await axios.delete(`${BASE()}/redosificaciones/${idRedos}`, { headers: getHeaders() });
  return data;
};

/* ═══ Pastón de pruebas ═══ */
export const listarPastones = async (idDosif) => {
  const { data } = await axios.get(`${BASE()}/${idDosif}/pastones`, { headers: getHeaders() });
  return data;
};
export const crearPaston = async (idDosif, body) => {
  const { data } = await axios.post(`${BASE()}/${idDosif}/pastones`, body, { headers: getHeaders() });
  return data;
};
export const obtenerPaston = async (idDosif, pid) => {
  const { data } = await axios.get(`${BASE()}/${idDosif}/pastones/${pid}`, { headers: getHeaders() });
  return data;
};
export const actualizarPaston = async (idDosif, pid, body) => {
  const { data } = await axios.put(`${BASE()}/${idDosif}/pastones/${pid}`, body, { headers: getHeaders() });
  return data;
};
export const eliminarPaston = async (idDosif, pid) => {
  const { data } = await axios.delete(`${BASE()}/${idDosif}/pastones/${pid}`, { headers: getHeaders() });
  return data;
};

/* ═══ Correcciones post-pastón ═══ */
export const listarCorrecciones = async (idDosif) => {
  const { data } = await axios.get(`${BASE()}/${idDosif}/correcciones`, { headers: getHeaders() });
  return data;
};
export const aplicarCorrecciones = async (idDosif, correcciones) => {
  const { data } = await axios.post(`${BASE()}/${idDosif}/correcciones`, { correcciones }, { headers: getHeaders() });
  return data;
};

/* ═══ Aptitud de materiales ═══ */
export const verificarAptitudMateriales = async (idDosif) => {
  const { data } = await axios.get(`${BASE()}/${idDosif}/aptitud-materiales`, { headers: getHeaders() });
  return data;
};

export const verificarAptitudMaterialesByParams = async (params) => {
  const { data } = await axios.post(`${BASE()}/aptitud-materiales-calc`, params, { headers: getHeaders() });
  return data;
};

/* ═══ Parametros de Trabajabilidad ═══ */
export const getParametrosTrabajabilidad = async () => {
  const { data } = await axios.get(`${config.backendUrl}/api/parametros-trabajabilidad`, { headers: getHeaders() });
  return data;
};
export const updateParametroTrabajabilidad = async (id, body) => {
  const { data } = await axios.put(`${config.backendUrl}/api/parametros-trabajabilidad/${id}`, body, { headers: getHeaders() });
  return data;
};
export const createParametroTrabajabilidad = async (body) => {
  const { data } = await axios.post(`${config.backendUrl}/api/parametros-trabajabilidad`, body, { headers: getHeaders() });
  return data;
};
export const deleteParametroTrabajabilidad = async (id) => {
  const { data } = await axios.delete(`${config.backendUrl}/api/parametros-trabajabilidad/${id}`, { headers: getHeaders() });
  return data;
};

// ── Alertas de materiales ──
export const getAlertasDosificacion = async (dosifId) => {
  const { data } = await axios.get(`${BASE()}/${dosifId}/alertas`, { headers: getHeaders() });
  return data;
};
export const resolverAlertaDosificacion = async (alertaId, body) => {
  const { data } = await axios.put(`${BASE()}/alertas/${alertaId}/resolver`, body, { headers: getHeaders() });
  return data;
};

// ── Crear mezcla desde sugerencia ──
export const crearMezclaSugerida = async (data) => {
  const { data: resp } = await axios.post(`${BASE()}/crear-mezcla-sugerida`, data, { headers: getHeaders() });
  return resp;
};

// ── Sugerencias de mezcla ──
export const getMaterialesParaMezcla = async (plantaId) => {
  const { data } = await axios.get(`${config.backendUrl}/api/agregados/planta/${plantaId}/para-mezcla`, { headers: getHeaders() });
  return data;
};
export const sugerirMezclas = async (materiales, parametros) => {
  const { data } = await axios.post(`${BASE()}/sugerir-mezclas`, { materiales, parametros }, { headers: getHeaders() });
  return data;
};

// ── Preview de una combinación específica (editor interactivo) ──
// Envía componentes + proporciones exactas y devuelve los mismos indicadores
// que trae una sugerencia normal, sin optimizar.
export const previewMezcla = async (componentes, proporciones, parametros) => {
  const { data } = await axios.post(
    `${BASE()}/preview-mezcla`,
    { componentes, proporciones, parametros },
    { headers: getHeaders() },
  );
  return data;
};
