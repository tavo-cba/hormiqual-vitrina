import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { isOnPhone } from '../common/functions';
import { useToast } from './ToastContext';
import { useMenuContext } from './MenuContext';

// Lazy require para romper el ciclo de imports:
//   TabContext → routesConfig → DosificacionDisenoPage → WizardDosificacion → TabContext
// Importar `appRoutes` top-level causa que en ciertos órdenes de carga (HMR,
// builds reordenados) `TabProvider` quede en Temporal Dead Zone cuando un
// componente del ciclo intenta llamarlo antes de que su módulo termine de
// evaluarse. Cargarlo lazy en el callback evita evaluar `routesConfig.js`
// (y por ende todos sus componentes) durante el módulo top-level.
let _appRoutesCache = null;
const getAppRoutes = () => {
    if (_appRoutesCache) return _appRoutesCache;
    // eslint-disable-next-line global-require
    _appRoutesCache = require('../components/cover/routesConfig').appRoutes;
    return _appRoutesCache;
};

const TabContext = createContext(null);

const MAX_TABS = 15;
const STORAGE_KEY = 'tab-context-state';

export const TabProvider = ({ children }) => {
    const [tabs, setTabs] = useState(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (!Array.isArray(stored?.tabs)) return [];
            // Migrar tabs: conservar 'pinned', normalizar el resto a 'nav'
            return stored.tabs.map(tab => ({
                ...tab,
                initialPath: tab.initialPath || tab.path,
                type: tab.type === 'pinned' ? 'pinned' : 'nav',
            }));
        } catch (error) {
            console.error('Error loading stored tabs', error);
            return [];
        }
    });
    const [activeTabId, setActiveTabId] = useState(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
            return stored?.activeTabId || null;
        } catch {
            return null;
        }
    });
    const [tabReloadKeys, setTabReloadKeys] = useState({});
    const idRef = useRef(0);
    const toast = useToast();
    const navigate = useNavigate();
    const location = useLocation();
    const { menus } = useMenuContext();

    // Registro de funciones navigate de cada MemoryRouter (por tabId)
    const tabNavigatorsRef = useRef({});

    // Scroll position guardada por tabId — para restaurar al volver a una pestaña
    const scrollPositionsRef = useRef({});

    // Refs espejo de tabs/activeTabId — necesarios para que closeTab pueda
    // leer el valor actual aún cuando es invocado desde un setTimeout viejo
    // (la animación de cierre en TabBar retrasa la llamada 250ms; durante
    // esa ventana el usuario puede abrir/activar otras pestañas y la
    // closure del closeTab original queda desactualizada). [[bug-tab-stale-close]]
    const tabsRef = useRef(tabs);
    const activeTabIdRef = useRef(activeTabId);
    useLayoutEffect(() => { tabsRef.current = tabs; }, [tabs]);
    useLayoutEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

    useEffect(() => {
        const maxId = tabs.reduce((max, tab) => {
            const match = typeof tab.id === 'string' ? tab.id.match(/tab-(\d+)/) : null;
            const numeric = match ? Number(match[1]) : 0;
            return Number.isNaN(numeric) ? max : Math.max(max, numeric);
        }, 0);
        idRef.current = maxId + 1;
    }, []);

    const nextId = useCallback(() => {
        const value = idRef.current;
        idRef.current += 1;
        return `tab-${value}`;
    }, []);

    const findRouteDefinition = useCallback(
        (path) => getAppRoutes().find((route) => matchPath({ path: route.path, end: true }, path)),
        []
    );

    const findMenuLabel = useCallback(
        (path) => {
            const search = (items = []) => {
                for (const item of items) {
                    if (item.ruta === path) return item.nombre;
                    if (item.children) {
                        const found = search(item.children);
                        if (found) return found;
                    }
                }
                return null;
            };
            return search(menus);
        },
        [menus]
    );

    const findMenuIcon = useCallback(
        (path) => {
            const search = (items = []) => {
                for (const item of items) {
                    if (item.ruta === path) return item.icono;
                    if (item.children) {
                        const found = search(item.children);
                        if (found) return found;
                    }
                }
                return null;
            };
            return search(menus);
        },
        [menus]
    );

    const buildTab = useCallback(
        (path, label, type = 'nav') => {
            const route = findRouteDefinition(path);
            if (!route) return null;
            return {
                id: nextId(),
                type,
                initialPath: path,
                path,
                label: label || findMenuLabel(path) || route.tabLabel || path,
                icon: findMenuIcon(path) || 'fa-solid fa-file-lines',
            };
        },
        [findMenuIcon, findMenuLabel, findRouteDefinition, nextId]
    );

    // Restaurar scroll al cambiar de pestaña activa (antes del pintado para evitar flash)
    useLayoutEffect(() => {
        if (!activeTabId) return;
        const savedY = scrollPositionsRef.current[activeTabId] ?? 0;
        window.scrollTo(0, savedY);
    }, [activeTabId]);

    // Registrar el navigate del MemoryRouter de una tab
    const registerTabNavigator = useCallback((tabId, navigateFn) => {
        tabNavigatorsRef.current[tabId] = navigateFn;
        return () => { delete tabNavigatorsRef.current[tabId]; };
    }, []);

    // Actualizar la ruta actual de una tab (llamado desde TabInternalSync)
    const updateTabPath = useCallback((tabId, newPath, newLabel, newIcon) => {
        setTabs(prev => prev.map(t =>
            t.id === tabId
                ? {
                    ...t,
                    path: newPath,
                    ...(newLabel ? { label: newLabel } : {}),
                    ...(newIcon ? { icon: newIcon } : {}),
                  }
                : t
        ));
    }, []);

    // Agregar a favoritos (right-click en menú o desde código)
    // Los favoritos son accesos directos que se muestran en el menú de favoritos (no en la barra)
    const openFavoriteTab = useCallback(
        (path, label) => {
            if (isOnPhone) return;
            const route = findRouteDefinition(path);
            if (!route) {
                toast('error', 'No se pudo agregar a favoritos porque la ruta no existe.');
                return;
            }

            setTabs((prevTabs) => {
                // Dedup: buscar por initialPath entre tabs pinned
                const existing = prevTabs.find((tab) => tab.type === 'pinned' && tab.initialPath === path);
                if (existing) {
                    toast('info', 'Ya está en tus favoritos.');
                    return prevTabs;
                }

                if (prevTabs.length >= MAX_TABS) {
                    toast('error', `Solo puedes tener ${MAX_TABS} pestañas abiertas de forma simultánea.`);
                    return prevTabs;
                }

                const newTab = buildTab(path, label, 'pinned');
                if (!newTab) return prevTabs;

                toast('success', `"${label || newTab.label}" agregado a favoritos.`);
                return [...prevTabs, newTab];
            });
        },
        [buildTab, findRouteDefinition, toast]
    );

    // Eliminar un favorito
    const removeFavorite = useCallback((id) => {
        setTabs((prevTabs) => prevTabs.filter((tab) => tab.id !== id));
    }, []);

    // Alias para retrocompatibilidad con código existente
    const openTab = openFavoriteTab;

    // Abrir nueva pestaña de navegación en una ruta específica (middle-click en menú)
    const openNewTab = useCallback(
        (path, label) => {
            if (isOnPhone) return;
            const route = findRouteDefinition(path);
            if (!route) {
                toast('error', 'No se pudo abrir la pestaña porque la ruta no existe.');
                return;
            }
            if (tabs.length >= MAX_TABS) {
                toast('error', `Solo puedes tener ${MAX_TABS} pestañas abiertas de forma simultánea.`);
                return;
            }
            if (activeTabId) scrollPositionsRef.current[activeTabId] = window.scrollY;
            const newId = nextId();
            setTabs(prev => [...prev, {
                id: newId,
                type: 'nav',
                initialPath: path,
                path,
                label: label || findMenuLabel(path) || route.tabLabel || path,
                icon: findMenuIcon(path) || 'fa-solid fa-file-lines',
            }]);
            setActiveTabId(newId);
            navigate(path);
        },
        [activeTabId, findRouteDefinition, findMenuIcon, findMenuLabel, navigate, nextId, tabs.length, toast]
    );

    // Abrir nueva pestaña de navegación (botón "+")
    const openNavTab = useCallback(() => {
        if (isOnPhone) return;
        let nextActiveId = null;
        let doNavigate = false;
        setTabs((prevTabs) => {
            if (prevTabs.length >= MAX_TABS) {
                toast('error', `Solo puedes tener ${MAX_TABS} pestañas abiertas de forma simultánea.`);
                return prevTabs;
            }
            const newId = nextId();
            nextActiveId = newId;
            doNavigate = true;
            return [...prevTabs, {
                id: newId,
                type: 'nav',
                initialPath: '/',
                path: '/',
                label: 'Nueva pestaña',
                icon: 'fa-solid fa-home',
            }];
        });
        if (doNavigate && nextActiveId) {
            // Guardar scroll de la pestaña saliente
            if (activeTabId) scrollPositionsRef.current[activeTabId] = window.scrollY;
            setActiveTabId(nextActiveId);
            navigate('/');
        }
    }, [activeTabId, nextId, navigate, toast]);

    // Navegar dentro de la pestaña activa (left-click en menú)
    const navigateActive = useCallback((path, label) => {
        const activeTab = tabs.find(t => t.id === activeTabId);
        const isPinnedActive = activeTab?.type === 'pinned';

        if (!isPinnedActive) {
            // Tab normal activa: navegar dentro de ella
            const nav = activeTabId ? tabNavigatorsRef.current[activeTabId] : null;
            if (nav) {
                nav(path);
                return;
            }

            // Sin tab activa → home sale del sistema, resto crea nueva tab
            if (path === '/') {
                setActiveTabId(null);
                navigate(path);
                return;
            }
            const route = findRouteDefinition(path);
            if (!route) { navigate(path); return; }
            if (activeTabId) scrollPositionsRef.current[activeTabId] = window.scrollY;
            const newId = nextId();
            setTabs(prev => [...prev, {
                id: newId, type: 'nav', initialPath: path, path,
                label: label || findMenuLabel(path) || route.tabLabel || path,
                icon: findMenuIcon(path) || 'fa-solid fa-home',
            }]);
            setActiveTabId(newId);
            navigate(path);
            return;
        }

        // Tab activa es PINNED: siempre abrir nueva tab de navegación (no modificar la pinned)
        if (path === '/') {
            setActiveTabId(null);
            navigate(path);
            return;
        }
        const route = findRouteDefinition(path);
        if (!route) { navigate(path); return; }
        if (tabs.length >= MAX_TABS) {
            toast('error', `Solo puedes tener ${MAX_TABS} pestañas abiertas.`);
            return;
        }
        scrollPositionsRef.current[activeTabId] = window.scrollY;
        const newId = nextId();
        setTabs(prev => [...prev, {
            id: newId, type: 'nav', initialPath: path, path,
            label: label || findMenuLabel(path) || route.tabLabel || path,
            icon: findMenuIcon(path) || 'fa-solid fa-home',
        }]);
        setActiveTabId(newId);
        navigate(path);
    }, [activeTabId, tabs, findRouteDefinition, nextId, navigate, findMenuIcon, findMenuLabel, toast]);

    // Abrir pestaña de componente sin ruta (bonus para vistas custom)
    const openComponentTab = useCallback((componentKey, componentProps, label, icon) => {
        if (isOnPhone) return;
        setTabs((prevTabs) => {
            if (prevTabs.length >= MAX_TABS) {
                toast('error', `Solo puedes tener ${MAX_TABS} pestañas abiertas de forma simultánea.`);
                return prevTabs;
            }
            const existing = prevTabs.find(t => t.type === 'component' && t.componentKey === componentKey);
            if (existing) {
                setActiveTabId(existing.id);
                return prevTabs;
            }
            const newId = nextId();
            setActiveTabId(newId);
            return [...prevTabs, {
                id: newId,
                type: 'component',
                componentKey,
                componentProps: componentProps || {},
                label,
                icon: icon || 'fa-solid fa-puzzle-piece',
            }];
        });
    }, [nextId, toast]);

    const activateTab = useCallback(
        (id) => {
            const target = tabs.find((tab) => tab.id === id);
            if (!target) return;
            // Guardar scroll de la pestaña saliente antes del cambio
            if (activeTabId) scrollPositionsRef.current[activeTabId] = window.scrollY;
            setActiveTabId(id);
            navigate(target.path);
        },
        [activeTabId, navigate, tabs]
    );

    // closeTab lee tabs/activeTabId vía refs para ser idempotente frente a
    // closures viejas (caso típico: TabBar.handleCloseTab dispara el close
    // real dentro de un setTimeout para acompañar la animación; durante esos
    // 250ms el usuario puede abrir/activar otras pestañas y una closure
    // que capturó `tabs`/`activeTabId` al inicio quedaría desactualizada).
    const closeTab = useCallback(
        (id) => {
            const currentTabs = tabsRef.current;
            const currentActiveId = activeTabIdRef.current;

            const index = currentTabs.findIndex((tab) => tab.id === id);
            if (index === -1) return;

            const updated = currentTabs.filter((tab) => tab.id !== id);

            delete tabNavigatorsRef.current[id];
            delete scrollPositionsRef.current[id];

            setTabs(updated);

            if (currentActiveId !== id) return;

            const navOnly = updated.filter(t => t.type !== 'pinned');

            if (!navOnly.length) {
                setActiveTabId(null);
                navigate('/');
                return;
            }

            const closedNavIndex = currentTabs.filter(t => t.type !== 'pinned').findIndex(t => t.id === id);
            const nextActive = navOnly[Math.min(closedNavIndex, navOnly.length - 1)];
            setActiveTabId(nextActive.id);
            navigate(nextActive.path);
        },
        [navigate]
    );

    const reloadActiveTab = useCallback(() => {
        if (!activeTabId) return;
        setTabReloadKeys(prev => ({ ...prev, [activeTabId]: (prev[activeTabId] || 0) + 1 }));
    }, [activeTabId]);

    // Volver atrás en la historia interna de la pestaña activa
    const goBackActiveTab = useCallback(() => {
        if (!activeTabId) return;
        const nav = tabNavigatorsRef.current[activeTabId];
        if (nav) {
            nav(-1);
        }
    }, [activeTabId]);

    const reorderTabs = useCallback((sourceId, targetId) => {
        setTabs((prevTabs) => {
            if (sourceId === targetId) return prevTabs;

            const updated = [...prevTabs];
            const sourceIndex = updated.findIndex((tab) => tab.id === sourceId);
            const targetIndex = updated.findIndex((tab) => tab.id === targetId);

            if (sourceIndex === -1 || targetIndex === -1) return prevTabs;

            const [movedTab] = updated.splice(sourceIndex, 1);
            const insertionIndex = Math.min(targetIndex, updated.length);
            updated.splice(insertionIndex, 0, movedTab);

            return updated;
        });
    }, []);

    const getTabElement = useCallback(
        (path) => findRouteDefinition(path)?.element || null,
        [findRouteDefinition]
    );

    // Filtrar tabs con rutas inválidas (excepto componente)
    useEffect(() => {
        setTabs((prevTabs) => prevTabs.filter((tab) =>
            tab.type === 'component' ||
            findRouteDefinition(tab.path) ||
            findRouteDefinition(tab.initialPath)
        ));
    }, [findRouteDefinition]);

    // Interceptar window.history.back() y go() para que "volver atrás" funcione
    // dentro de la historia interna de la pestaña activa en lugar de la del BrowserRouter.
    useEffect(() => {
        if (!activeTabId) return undefined;

        const nativeBack = window.history.back.bind(window.history);
        const nativeGo = window.history.go.bind(window.history);

        window.history.back = () => {
            const nav = tabNavigatorsRef.current[activeTabId];
            if (nav) {
                nav(-1); // go(-1) en la historia interna de la tab
            } else {
                nativeBack();
            }
        };

        window.history.go = (delta) => {
            if (delta < 0) {
                const nav = tabNavigatorsRef.current[activeTabId];
                if (nav) {
                    nav(delta);
                    return;
                }
            }
            nativeGo(delta);
        };

        return () => {
            window.history.back = nativeBack;
            window.history.go = nativeGo;
        };
    }, [activeTabId]);

    // Location sync: sincronizar BrowserRouter URL con la pestaña activa
    useEffect(() => {
        // 0. Hay tab activa con navigator → no interferir con navegación interna.
        //    TabInternalSync actualiza tab.path y la URL bar via replaceState.
        //    Esto evita que cambios en `tabs` (de updateTabPath) disparen un switch
        //    de pestaña cuando el BrowserRouter quedó en '/' al crear una nueva tab.
        if (activeTabId && tabNavigatorsRef.current[activeTabId]) {
            return;
        }

        // 0b. activeTabId válido y tab existe → respetar el estado guardado.
        //     Evita que al recargar (F5) la URL del BrowserRouter sobreescriba
        //     la pestaña activa restaurada desde localStorage (especialmente pestañas fijadas).
        if (activeTabId && tabs.some(t => t.id === activeTabId)) {
            return;
        }

        // 1. Alguna tab tiene exactamente este path → activarla
        const matchingTab = tabs.find((tab) => tab.path === location.pathname);
        if (matchingTab) {
            if (activeTabId !== matchingTab.id) setActiveTabId(matchingTab.id);
            return;
        }

        // 2. Alguna tab tiene este initialPath → activarla (puede haberse movido
        //    a otra ruta por navegación interna; su initialPath queda en la URL
        //    original del BrowserRouter)
        const matchingInitial = tabs.find((tab) => tab.initialPath === location.pathname);
        if (matchingInitial) {
            if (activeTabId !== matchingInitial.id) setActiveTabId(matchingInitial.id);
            return;
        }

        // 3. Sin coincidencia: salir del modo pestaña
        setActiveTabId(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname, tabs]);

    // Persistir en localStorage (no persistir component tabs)
    useEffect(() => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                tabs: tabs.filter(t => t.type !== 'component'),
                activeTabId,
            })
        );
    }, [activeTabId, tabs]);

    const hasTabs = useMemo(() => tabs.length > 0, [tabs]);
    const favorites = useMemo(() => tabs.filter(t => t.type === 'pinned'), [tabs]);

    return (
        <TabContext.Provider
            value={{
                tabs,
                activeTabId,
                hasTabs,
                favorites,
                getTabElement,
                openTab,
                openFavoriteTab,
                removeFavorite,
                openNewTab,
                openNavTab,
                navigateActive,
                openComponentTab,
                closeTab,
                activateTab,
                reorderTabs,
                reloadActiveTab,
                goBackActiveTab,
                tabReloadKeys,
                registerTabNavigator,
                updateTabPath,
                findMenuIcon,
            }}
        >
            {children}
        </TabContext.Provider>
    );
};

export const useTabContext = () => useContext(TabContext);
