import React from 'react';
import { Tag } from 'primereact/tag';

/**
 * Badge visual del estado de calibración de un equipo.
 *
 * Props:
 *   estado: 'sin_calibrar' | 'vencida' | 'por_vencer' | 'vigente'
 *   diasParaVencer: number | null
 */
const CONFIG = {
  vigente:        { severity: 'success', icon: 'fa-solid fa-circle-check',        label: 'Vigente' },
  por_vencer:     { severity: 'warning', icon: 'fa-solid fa-triangle-exclamation', label: 'Por vencer' },
  vencida:        { severity: 'danger',  icon: 'fa-solid fa-circle-xmark',         label: 'Vencida' },
  sin_calibrar:   { severity: 'info',    icon: 'fa-solid fa-circle-question',      label: 'Sin calibrar' },
};

const CalibracionStatusBadge = ({ estado, diasParaVencer }) => {
  const cfg = CONFIG[estado] || CONFIG.sin_calibrar;
  let label = cfg.label;
  if (estado === 'por_vencer' && diasParaVencer != null) {
    label = `Por vencer (${diasParaVencer} d)`;
  } else if (estado === 'vencida' && diasParaVencer != null && diasParaVencer < 0) {
    label = `Vencida hace ${Math.abs(diasParaVencer)} d`;
  }
  return <Tag severity={cfg.severity} icon={cfg.icon} value={label} />;
};

export default CalibracionStatusBadge;
