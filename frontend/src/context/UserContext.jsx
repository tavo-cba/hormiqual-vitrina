import { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { config } from '../config/config';

const UserContext = createContext();
/** Hook para consumir el contexto */
export const useUserContext = () => useContext(UserContext);

/** Constantes de máscara de bits para permisos */
export const PERMISOS = {
  ADMIN: 1 << 0, // 1
  ADMIN_WRITE: 1 << 1, // 2
  ADMIN_DELETE: 1 << 2, // 4
  PROD_WRITE: 1 << 3, // 8
  PROD_DELETE: 1 << 4, //16
};

/** Función auxiliar opcional para desglosar en booleanos */
const parsePermisos = (valor) => ({
  esAdmin: Boolean(valor & PERMISOS.ADMIN),
  puedeEscribirAdm: Boolean(valor & PERMISOS.ADMIN_WRITE),
  puedeBorrarAdm: Boolean(valor & PERMISOS.ADMIN_DELETE),
  puedeEscribirProd: Boolean(valor & PERMISOS.PROD_WRITE),
  puedeBorrarProd: Boolean(valor & PERMISOS.PROD_DELETE),
});

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState({
    name: '',
    lastname: '',
    permission: 0,
    permissions: parsePermisos(0),
    menuPerms: {},
  });

  /**
   * hasPermission: recibe la clave de PERMISOS (ej. "ADMIN_WRITE")
   * y comprueba el bit correspondiente en user.permission
   */
  const hasPermission = (clave) =>
    user.permissions.esAdmin ||
    Boolean(user.permission & PERMISOS[clave]);

  /** Trae el usuario actual desde el endpoint /api/auth/user */
  const obtenerUsuario = async () => {
    try {
      const { data } = await axios.get(
        `${config.backendUrl}/api/auth/user`,
        { headers: config.headers }
      );
      const permisosParseados = parsePermisos(data.permission);
      setUser({
        name: data.name,
        lastname: data.lastname,
        permission: data.permission,
        permissions: permisosParseados,
        // isAdmin: priorizar el flag directo (data.isAdmin) si vino; cae al
        // bitmask de permisos como fallback para sesiones viejas.
        isAdmin: data.isAdmin === true || permisosParseados.esAdmin,
        plantaIds: data.plantaIds,
        allPlantas: data.allPlantas,
        accesoAgente: data.accesoAgente,
        roles: data.roles,
        idEmpleado: data.idEmpleado,
        rolCalidad: data.rolCalidad ?? null,
        rolFlota: data.rolFlota ?? null,
        rolMantenimiento: data.rolMantenimiento ?? null,
        // Sin esta propagación, `useRolProduccion()` siempre devuelve
        // `puede(...)=false` y el plantista queda bloqueado para reordenar
        // y enviar a Betonmatic. Análogo a los otros tres roles de módulo.
        rolProduccion: data.rolProduccion ?? null,
        menuPerms: data.menuPerms || {},
        disabledModuleRoutes: data.disabledModuleRoutes || [],
      });
    } catch (err) {
      console.error('No se pudo cargar el usuario:', err);
    }
  };

  useEffect(() => {
    obtenerUsuario();
  }, []);

  return (
    <UserContext.Provider value={{ user, hasPermission, setUser }}>
      {children}
    </UserContext.Provider>
  );
};
