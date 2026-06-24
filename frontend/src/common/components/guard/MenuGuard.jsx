import React from 'react';
import { useLocation, Outlet } from 'react-router-dom';
import { useMenuContext } from '../../../context/MenuContext';
import { useUserContext } from '../../../context/UserContext';
import NonPerm from '../nonperm/nonperm';
import ModuloNoDisponible from '../modulo-no-disponible/ModuloNoDisponible';

// Refactor 2026-05-20: el bloqueo específico para CLIENTE externo se quitó
// junto con el concepto. El gating queda en hands del árbol de PermisoMenu
// (`canAccessRoute`) y del flag `isAdmin` (bypass).

const tipoToPath = {
  1: '/admin/empleados',
  2: '/flota/equipos',
  3: '/admin/plantas',
  4: '/admin/prensas',
  5: '/admin/obras',
  6: '/flota/fuentes',
};

export const hasRoutePermission = (location, { hasPermission, canAccessRoute, getActions }) => {
  if (location.pathname === '/') {
    return true;
  }

  if (hasPermission('ADMIN') || canAccessRoute(location.pathname)) {
    return true;
  }
  const archivoMatch = location.pathname.match(/^\/admin\/archivo\/(\d+)\/\d+$/);
  if (archivoMatch) {
    const tipo = Number(archivoMatch[1]);
    const path = tipoToPath[tipo];
    if (path) {
      const { puedeAgregar, puedeEditar, puedeBorrar } = getActions(path);
      if (puedeAgregar && puedeEditar && puedeBorrar) {
        return true;
      }
    }
  }

  return false;
};

const isDisabledModuleRoute = (pathname, disabledModuleRoutes) => {
  if (!disabledModuleRoutes?.length) return false;
  return disabledModuleRoutes.some(r => pathname.startsWith(r));
};

const MenuGuard = () => {
  const { canAccessRoute, menusLoaded, getActions } = useMenuContext();
  const { hasPermission, user } = useUserContext();
  const location = useLocation();

  if (!menusLoaded) return null;

  // Check disabled modules BEFORE permission check (applies even to admins)
  if (isDisabledModuleRoute(location.pathname, user.disabledModuleRoutes)) {
    return <ModuloNoDisponible />;
  }

  if (hasRoutePermission(location, { hasPermission, canAccessRoute, getActions })) {
    return <Outlet />;
  }

  return <NonPerm />;
};

export default MenuGuard;