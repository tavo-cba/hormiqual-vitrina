import React, { useId } from 'react';
import { Tooltip } from 'primereact/tooltip';
import './HelpIcon.css';

/**
 * Ícono "(?)" con tooltip propio de PrimeReact (NO usa el title nativo, que es
 * lento y no funciona en touch).
 *
 * Self-contained: cada instancia genera un target único y crea su propio
 * <Tooltip> al lado, lo que evita problemas de timing/z-index/append en
 * árboles complejos (tablas, tabs, dashboards).
 *
 * Consolida los antiguos HelpIcon duplicados de `tablero-comercial` y
 * `tablero-rrhh` (eran idénticos salvo el nombre de la clase CSS). El estilo
 * vive acá en HelpIcon.css bajo `.app-help-icon` / `.app-help-tooltip`.
 *
 * Props:
 *  - text: contenido del tooltip (si es vacío/null, no renderiza nada).
 *  - position: posición del tooltip ('top' | 'bottom' | 'left' | 'right').
 *  - className / tooltipClassName: clases extra opcionales (back-compat / casos
 *    puntuales que necesiten override de estilo).
 */
const HelpIcon = ({ text, position = 'top', className = '', tooltipClassName = '' }) => {
  const rawId = useId();
  // useId puede contener ":" — inválido en className/selector; lo sanitizamos.
  const cls = `help-${rawId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  if (!text) return null;

  return (
    <>
      <Tooltip
        target={`.${cls}`}
        position={position}
        className={`app-help-tooltip ${tooltipClassName}`.trim()}
        showDelay={120}
        hideDelay={0}
      />
      <i
        className={`app-help-icon ${className} ${cls} fa-solid fa-circle-question`.replace(/\s+/g, ' ').trim()}
        data-pr-tooltip={text}
        data-pr-position={position}
        aria-label={text}
        tabIndex={0}
      />
    </>
  );
};

export default HelpIcon;
