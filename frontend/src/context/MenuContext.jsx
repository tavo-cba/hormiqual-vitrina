import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
} from 'react';
import axios from 'axios';
import { config } from '../config/config';
import { useUserContext } from './UserContext';
export { flattenMenusToIndex } from '../utils/menuIndex';

// Refactor 2026-05-20: el filtrado de menús para CLIENTE (capa B de roles)
// se eliminó junto con el concepto de "cliente externo". Los menús visibles
// dependen únicamente del árbol de PermisoMenu por usuario.

// Creamos el contexto
const MenuContext = createContext();

// Exportamos el Provider para usarlo en el árbol principal
export const MenuProvider = ({ children }) => {
  // isHovered => define si el menú está expandido
  // showText => define si mostramos los textos después de un pequeño delay
  const [isHovered, setIsHovered] = useState(false);
  const [showText, setShowText] = useState(false);
  const [menus, setMenus] = useState([]);
  const [menuPaths, setMenuPaths] = useState([]);
  const [permMap, setPermMap] = useState({});
  const [loaded, setLoaded] = useState(false);
  // Ref para poder limpiar el setTimeout
  const timeoutRef = useRef(null);
  const { user } = useUserContext();

  // Normaliza cualquier permiso a booleano para evitar "0" renderizado en JSX
  const normalizePerms = (perms = {}) => {
    if (!perms || typeof perms !== 'object') return {};
    return Object.entries(perms).reduce((acc, [key, value]) => {
      acc[key] = typeof value === 'number' ? value !== 0 : Boolean(value);
      return acc;
    }, {});
  };

  // Al montar el context, leemos localStorage para arrancar con la preferencia guardada
  useEffect(() => {
    const menuState = localStorage.getItem('menu') === '1';
    setIsHovered(menuState);
    setShowText(menuState);
    loadMenus();
  }, []);

  useEffect(() => {
    if (menus.length) {
      const { paths, map } = flattenData(menus);
      setMenuPaths(paths);
      setPermMap(map);
    }
  }, [menus, user.menuPerms]);

  const flattenData = (arr, paths = [], map = {}) => {
    arr.forEach((m) => {
      if (m.ruta) {
        paths.push(m.ruta);
        map[m.ruta] = normalizePerms(user.menuPerms?.[m.idMenu]);
      }
      if (m.children) flattenData(m.children, paths, map);
    });
    return { paths, map };
  };


  const flattenPaths = (arr, out = []) => {
    arr.forEach((m) => {
      if (m.ruta) out.push(m.ruta);
      if (m.children) flattenPaths(m.children, out);
    });
    return out;
  };


  const loadMenus = async () => {
    try {
      const { data } = await axios.get(
        `${config.backendUrl}/api/menus/user`,
        { headers: config.headers }
      );
      setMenus(data);
      const { paths, map } = flattenData(data);
      setMenuPaths(paths);
      setPermMap(map);
    } catch (err) {
      console.error('No se pudieron cargar los menús', err);
    } finally {
      setLoaded(true);
    }
  };

  // Función para alternar abierto/cerrado
  const openMenu = (persist = true) => {
    setIsHovered(true);
    timeoutRef.current = setTimeout(() => setShowText(true), 250);
    if (persist) localStorage.setItem('menu', '1');
  };

  const closeMenu = (persist = true) => {
    setIsHovered(false);
    clearTimeout(timeoutRef.current);
    setShowText(false);
    if (persist) localStorage.setItem('menu', '0');
  };

  const toggleMenu = (persist = true) => {
    if (isHovered) {
      closeMenu(persist);
    } else {
      openMenu(persist);
    }
  };

  const getActions = (path) => {
    const entry = Object.entries(permMap).find(([p]) => path.startsWith(p));
    return entry ? entry[1] : {};
  };

  const canAccessRoute = (path) => {
    return menuPaths.some((p) => path.startsWith(p));
  };

  return (
    <MenuContext.Provider
      value={{
        isHovered, // Menú abierto o no
        showText, // Mostrar los textos o no
        toggleMenu, // Función para hacer clic en "Abrir/Plegar"
        openMenu,
        closeMenu,
        menus, // Menús dinámicos del usuario
        reloadMenus: loadMenus,
        canAccessRoute,
        getActions,
        menusLoaded: loaded,
      }}
    >
      {children}
    </MenuContext.Provider>
  );
};

// Hook para usar más cómodo nuestro contexto
export const useMenuContext = () => useContext(MenuContext);
