import React from 'react';
import { Tag } from 'primereact/tag';
import {
  CATEGORIA_COLORS,
  VEREDICTO,
  getCategoriaVeredicto,
  fromLegacyEval,
} from '../../../lib/compliance';

/**
 * Badge unificado para presentar el cumplimiento de un ensayo.
 *
 * Resuelve la categoría visual canónica (una de las 7 de VEREDICTO) implementando
 * el patrón "Hybrid Option B" del Prompt 2 con tres niveles de fallback. La
 * precedencia NO es arbitraria — cada nivel existe para resolver un caso
 * concreto de la realidad de los datos en producción:
 *
 *   1. `compliance` directo (prop, máxima prioridad).
 *      ─ POR QUÉ: el caller a veces ya tiene un compliance pre-computado por
 *      el backend con contexto que el frontend no conoce. Ej:
 *      `pdfResumen.items[i].compliance` viene del veredicto canónico per-item
 *      computado en `getResumen` (Prompt 3 C6.5), que considera el `uso`
 *      seleccionado, el contexto del material y todos los datos de aptitud.
 *      Re-derivar acá produciría un veredicto inferior. Si el caller pasa
 *      compliance, ese gana.
 *
 *   2. `ensayo.resultado._evaluacion.compliance` (persistido en BD).
 *      ─ POR QUÉ: cuando un ensayo se evalúa (createEnsayo / updateEnsayo
 *      desde Prompt 2 C6/C10), el motor escribe el `ComplianceResult` en
 *      `resultado._evaluacion.compliance`. Es la verdad CANÓNICA del ensayo
 *      al momento de su persistencia, y CONTRADICE al legacy `cumple` ENUM
 *      cuando aplica Hybrid Option B (D15+D20: ensayos donde el motor
 *      genera `passWithObservations` o `conditionalPass` mientras `cumple`
 *      queda en 'NO_CUMPLE' por compatibilidad). Acá el canónico debe ganar.
 *
 *   3. `fromLegacyEval(ensayo)` (último fallback).
 *      ─ POR QUÉ: ensayos persistidos PRE-Prompt 2 no tienen
 *      `_evaluacion.compliance`. Sólo tienen el ENUM legacy `cumple`. Para
 *      no romper la presentación de datos históricos, derivamos un
 *      `ComplianceResult` aproximado desde `cumple` + `detalle` + `observaciones`.
 *      Es lossy (NO recupera passWithObservations / conditionalPass desde
 *      legacy), pero alcanza para mostrar APTO / NO APTO / EVALUACIÓN
 *      INCOMPLETA correctamente. Cuando el ensayo se vuelva a editar y
 *      guardar, su compliance se recomputa y queda en nivel 2.
 *
 *   4. EVALUACIÓN INCOMPLETA (default seguro si no hay nada).
 *
 * Cambio observable C8: ensayos con legacy `cumple='NO_CUMPLE'` que tienen
 * `compliance.status='passWithObservations'` (Hybrid B) ya no se renderizan
 * como "NO APTO", sino como "APTO CON OBSERVACIONES" (verde con ícono info).
 *
 * @param {Object}  props
 * @param {Object}  [props.ensayo]      - Objeto ensayo (con `cumple`, `resultado`, etc.)
 * @param {Object}  [props.compliance]  - ComplianceResult ya resuelto. Si está, ignora ensayo.
 * @param {string}  [props.className]
 * @param {Object}  [props.style]
 * @param {string}  [props.title]       - Tooltip nativo
 * @param {boolean} [props.withIcon=true] - Si false, omite el ícono del Tag
 */
export function CumplimientoBadge({
  ensayo = null,
  compliance = null,
  className = '',
  style,
  title,
  withIcon = true,
}) {
  const categoria = resolveCategoria({ ensayo, compliance });
  const cfg = CATEGORIA_COLORS[categoria];
  return (
    <Tag
      value={categoria}
      severity={cfg.severity}
      icon={withIcon ? cfg.icon : undefined}
      className={className}
      style={style}
      title={title}
    />
  );
}

/**
 * Helper exportado para tests y para callers que necesiten la categoría sin
 * el componente (ej. para colorear un dot, ordenar una columna, etc.).
 */
export function resolveCategoria({ ensayo, compliance }) {
  if (compliance?.status) return getCategoriaVeredicto(compliance);
  if (!ensayo) return VEREDICTO.EVALUACION_INCOMPLETA;

  let r = ensayo.resultado;
  if (typeof r === 'string') {
    try { r = JSON.parse(r); } catch { r = null; }
  }
  const persisted = r?._evaluacion?.compliance;
  if (persisted?.status) return getCategoriaVeredicto(persisted);

  return getCategoriaVeredicto(fromLegacyEval(ensayo));
}

export default CumplimientoBadge;
