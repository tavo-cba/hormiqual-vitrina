import React from 'react';
import { Tag } from 'primereact/tag';
import { ROL_LABEL, ROL_SEVERITY, getRolPrincipal } from '../../../lib/roles';

/**
 * Badge compacto que muestra el rol principal del usuario actual.
 * Sirve como recordatorio visual de qué acciones tiene habilitadas.
 *
 * Uso:
 *   <RolBadge user={user} />
 *
 * Si el usuario no tiene rol canónico, no renderiza nada.
 */
export default function RolBadge({ user, size = 'small' }) {
  const rol = getRolPrincipal(user);
  if (!rol || !ROL_LABEL[rol]) return null;
  return (
    <Tag
      value={ROL_LABEL[rol]}
      severity={ROL_SEVERITY[rol] || 'info'}
      icon="fa-solid fa-user-shield"
      style={size === 'small' ? { fontSize: '0.7rem' } : undefined}
      title={`Rol activo en HormiQual: ${ROL_LABEL[rol]}`}
    />
  );
}
