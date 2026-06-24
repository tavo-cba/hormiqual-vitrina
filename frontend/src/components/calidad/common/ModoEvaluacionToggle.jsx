import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { SelectButton } from 'primereact/selectbutton';
import { Message } from 'primereact/message';
import {
  MODO_DESCRIPTIVO,
  MODO_NORMATIVO,
  MODOS_VALIDOS,
  normalizarModo,
} from '../../../lib/evaluacion';

/**
 * ModoEvaluacionToggle (decisión 2026-05-28).
 *
 * Selector de modo de evaluación (DESCRIPTIVO vs NORMATIVO) con banner
 * informativo del modo activo. Persistencia en localStorage por `pageKey`
 * para que cada página recuerde su modo independientemente.
 *
 *   DESCRIPTIVO: el documento NO emite valoración normativa. Muestra los
 *   datos del material/dosificación sin "cumple/no cumple". Para dosificación
 *   incluye los valores normativos como referencia al lado de los calculados.
 *
 *   NORMATIVO: el documento evalúa contra la matriz CIRSOC 200:2024 + IRAM
 *   estricta, independiente del catálogo del tenant. Emite veredictos formales.
 *
 * Back-compat: acepta strings viejos ('PRESTACIONAL', 'PRESCRIPTIVO') y los
 * normaliza vía `normalizarModo`. Toda la persistencia y la API externa
 * trabajan con los strings canónicos nuevos.
 *
 * Props:
 *   - pageKey: identificador único por pantalla. Ej: 'fichaTecnica', 'dosificacion'.
 *   - value: modo controlado (opcional). Si se pasa, el componente es controlado.
 *   - onChange: callback cuando cambia el modo. Recibe el nuevo modo canónico.
 *   - defaultModo: modo inicial si no hay valor en localStorage. Default DESCRIPTIVO.
 *   - banner: si true, muestra `<Message>` con explicación del modo activo. Default true.
 *   - declarativo: leyenda extra "scope informativo".
 *   - fixed: oculta el SelectButton (solo banner).
 *   - fixedReason: texto extra cuando `fixed`.
 *   - className: clase extra para el wrapper.
 */

const STORAGE_PREFIX = 'modoEvaluacion:';

const OPTIONS = [
  { label: 'Descriptivo', value: MODO_DESCRIPTIVO },
  { label: 'Normativo',   value: MODO_NORMATIVO },
];

const BANNER_DESCRIPTIVO = {
  severity: 'info',
  text: 'Modo DESCRIPTIVO: el documento muestra los datos del material y/o dosificación sin emitir valoración normativa. Apto para documentación interna y para entrega al cliente como ficha técnica.',
};

const BANNER_NORMATIVO = {
  severity: 'warn',
  text: 'Modo NORMATIVO: el documento evalúa contra la matriz CIRSOC 200-2024 + serie IRAM estricta, independiente del catálogo del tenant. Apto para auditorías externas, licitaciones y contraste normativo.',
};

/**
 * Hook auxiliar: lee/persiste el modo en localStorage por pageKey.
 * Normaliza valores leídos (acepta strings viejos PRESTACIONAL/PRESCRIPTIVO).
 */
export function useModoEvaluacion(pageKey, defaultModo = MODO_DESCRIPTIVO) {
  const storageKey = `${STORAGE_PREFIX}${pageKey}`;
  const defaultCanon = normalizarModo(defaultModo);

  const [modo, setModoState] = useState(() => {
    if (typeof window === 'undefined' || !window.localStorage) return defaultCanon;
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v == null) return defaultCanon;
      // Acepta strings viejos y los normaliza a canónico nuevo.
      return MODOS_VALIDOS.has(v) ? normalizarModo(v) : defaultCanon;
    } catch {
      return defaultCanon;
    }
  });

  const setModo = useCallback((next) => {
    if (!MODOS_VALIDOS.has(next)) return;
    const canon = normalizarModo(next);
    setModoState(canon);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(storageKey, canon);
      }
    } catch {
      // Silencioso: localStorage puede fallar en modo privado.
    }
  }, [storageKey]);

  return [modo, setModo];
}

const ModoEvaluacionToggle = ({
  pageKey,
  value,
  onChange,
  defaultModo = MODO_DESCRIPTIVO,
  banner = true,
  declarativo = false,
  fixed = false,
  fixedReason = null,
  className = '',
}) => {
  // Cuando no se controla externamente, el componente persiste solo.
  const [internalModo, setInternalModo] = useModoEvaluacion(pageKey, defaultModo);
  const isControlled = value !== undefined && typeof onChange === 'function';
  // Acepta valores viejos vía normalizarModo en el path controlado también.
  const modo = isControlled ? normalizarModo(value) : internalModo;

  const handleChange = (e) => {
    const next = e.value;
    if (!MODOS_VALIDOS.has(next)) return;
    const canon = normalizarModo(next);
    if (isControlled) {
      onChange(canon);
    } else {
      setInternalModo(canon);
    }
  };

  // Sync inicial si el padre pasa un value distinto al persistido.
  useEffect(() => {
    if (isControlled && value !== internalModo) {
      setInternalModo(normalizarModo(value));
    }
  }, [isControlled, value, internalModo, setInternalModo]);

  const bannerCfg = useMemo(
    () => modo === MODO_NORMATIVO ? BANNER_NORMATIVO : BANNER_DESCRIPTIVO,
    [modo]
  );

  const bannerText = declarativo
    ? `${bannerCfg.text} (Indicación de scope: las métricas estadísticas no cambian con el modo, sólo el criterio de evaluación normativo asociado.)`
    : bannerCfg.text;

  return (
    <div className={`modo-evaluacion-toggle ${className}`}>
      {!fixed && (
        <div className="flex flex-wrap align-items-center gap-2 mb-2">
          <span className="text-sm text-500">Modo del documento:</span>
          <SelectButton
            value={modo}
            options={OPTIONS}
            onChange={handleChange}
            allowEmpty={false}
          />
        </div>
      )}
      {banner && (
        <Message
          severity={bannerCfg.severity}
          text={bannerText}
          className="w-full mb-3"
        />
      )}
      {fixed && fixedReason && (
        <Message
          severity="secondary"
          text={`Modo fijado: ${fixedReason}`}
          className="w-full mb-3"
        />
      )}
    </div>
  );
};

export default ModoEvaluacionToggle;
