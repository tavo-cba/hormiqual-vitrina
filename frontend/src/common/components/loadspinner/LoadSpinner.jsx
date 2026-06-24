import React from 'react';
import './LoadSpinner.css';

/**
 * LoadSpinner
 *
 * Props:
 * ▸ size   → número | string  (px, rem, etc.)  – default 50
 * ▸ color  → string (hex, rgb, hsl…)           – opcional (usa --text-color por defecto)
 * ▸ className → string                         – opcional
 *
 * Ejemplo:
 *   <LoadSpinner size={80} color="#ff6b00" />
 */
const LoadSpinner = ({ size = 50, color, className }) => {
  const numSize = typeof size === 'string' ? parseInt(size, 10) || 50 : size;
  const borderWidth = Math.max(2, Math.round(numSize / 12));

  return (
    <div
      className={`load-spinner ${className || ''}`}
      style={{
        width: numSize,
        height: numSize,
        borderWidth: borderWidth,
        ...(color ? { borderTopColor: color } : {}),
      }}
      aria-label="Cargando…"
    />
  );
};

export default LoadSpinner;
