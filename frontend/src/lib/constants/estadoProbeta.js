/**
 * Constantes de `EstadoProbeta` para el flujo de probetas y ensayos
 * (Bloque 8 auditoría 08 — Mej-04 / Mej-05).
 *
 * Antes: los IDs (1..5) y labels ("Curando"/"Pendiente"/etc.) estaban
 * hardcoded como "magic numbers" en cada componente que los consumía
 * (probeta.jsx, ProbetaDetailDialog.jsx, etc.). Esto los hace frágiles si
 * los seeds de la DB cambian, y obliga a sincronizar manualmente la UI con
 * el backend.
 *
 * Decisión: centralizar acá. Si en el futuro los seeds cambian, este es el
 * único archivo a tocar (más el seeder backend equivalente).
 *
 * Espejo del catálogo `EstadoProbeta` del backend. Mantener sincronizado.
 */

export const ESTADO_PROBETA = Object.freeze({
  CURANDO:    1,
  PENDIENTE:  2,
  ENSAYADA:   3,
  DESCARTADA: 4,
  PERDIDA:    5,
});

export const ESTADO_PROBETA_LABEL = Object.freeze({
  [ESTADO_PROBETA.CURANDO]:    'Curando',
  [ESTADO_PROBETA.PENDIENTE]:  'Pendiente',
  [ESTADO_PROBETA.ENSAYADA]:   'Ensayada',
  [ESTADO_PROBETA.DESCARTADA]: 'Descartada',
  [ESTADO_PROBETA.PERDIDA]:    'Perdida',
});

/**
 * Estados que NO permiten cargar un ensayo de resistencia (probeta en estado
 * terminal). Mirror EXACTO de `ESTADOS_NO_ENSAYABLES` del backend
 * (`src/domain/normRef/estadoProbeta.js`) — mantener sincronizado. Cualquier
 * otro estado (Curando / Pendiente / Ensayada) admite carga/edición del ensayo:
 * la probeta puede romperse mientras todavía figura "Curando" porque nada
 * flipea automáticamente Curando→Pendiente al vencer la fecha de rotura.
 */
export const ESTADOS_NO_ENSAYABLES = Object.freeze([
  ESTADO_PROBETA.DESCARTADA,
  ESTADO_PROBETA.PERDIDA,
]);

/**
 * Clave abreviada del estado, usada en filtros de URL (`?estado=CUR`,
 * `?estado=ENS`, etc.) y en SelectButton.
 */
export const ESTADO_PROBETA_KEY = Object.freeze({
  [ESTADO_PROBETA.CURANDO]:    'CUR',
  [ESTADO_PROBETA.PENDIENTE]:  'PEND',
  [ESTADO_PROBETA.ENSAYADA]:   'ENS',
  [ESTADO_PROBETA.DESCARTADA]: 'DES',
  [ESTADO_PROBETA.PERDIDA]:    'PER',
});

export const KEY_TO_ESTADO_PROBETA = Object.freeze(
  Object.fromEntries(
    Object.entries(ESTADO_PROBETA_KEY).map(([id, key]) => [key, Number(id)])
  )
);

/**
 * Clase CSS por estado para badge en tablas. Define en `probeta.css` con
 * override `[data-theme="dark"]` para que el dark mode funcione (M-UX-01).
 */
export const ESTADO_PROBETA_CLASS = Object.freeze({
  [ESTADO_PROBETA.CURANDO]:    'estado-badge estado-badge--curando',
  [ESTADO_PROBETA.PENDIENTE]:  'estado-badge estado-badge--pendiente',
  [ESTADO_PROBETA.ENSAYADA]:   'estado-badge estado-badge--ensayada',
  [ESTADO_PROBETA.DESCARTADA]: 'estado-badge estado-badge--descartada',
  [ESTADO_PROBETA.PERDIDA]:    'estado-badge estado-badge--perdida',
});

export const ESTADO_PROBETA_FILTRO_OPCIONES = Object.freeze([
  { label: 'Ver todas', value: 'ALL' },
  { label: 'Pendientes', value: ESTADO_PROBETA_KEY[ESTADO_PROBETA.PENDIENTE] },
  { label: 'Curando',    value: ESTADO_PROBETA_KEY[ESTADO_PROBETA.CURANDO] },
  { label: 'Ensayadas',  value: ESTADO_PROBETA_KEY[ESTADO_PROBETA.ENSAYADA] },
  { label: 'Descartadas', value: ESTADO_PROBETA_KEY[ESTADO_PROBETA.DESCARTADA] },
  { label: 'Perdidas',   value: ESTADO_PROBETA_KEY[ESTADO_PROBETA.PERDIDA] },
]);
