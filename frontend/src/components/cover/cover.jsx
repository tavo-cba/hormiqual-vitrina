import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import './cover.css';
import Navbar from "../navbar/navbar";
import Login from "../login/login";
import { config } from "../../config/config";
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, matchPath } from "react-router-dom";
import { UNSAFE_NavigationContext, UNSAFE_LocationContext, UNSAFE_RouteContext, parsePath } from "react-router";
import Topbar from "../topbar/topbar";
import { useMenuContext } from "../../context/MenuContext";
import { isOnPhone } from "../../common/functions";
// ScrollToTop se omite intencionalmente aquí — el sistema de pestañas maneja
// el scroll por cuenta propia (useLayoutEffect en TabContext).
import LoadSpinner from "../../common/components/loadspinner/LoadSpinner";
import MenuGuard, { hasRoutePermission } from "../../common/components/guard/MenuGuard";
import { TabProvider, useTabContext } from "../../context/TabContext";
import TabBar from "../topbar/TabBar";
import { appRoutes, protectedRoutes, publicRoutes, standaloneRoutes } from "./routesConfig";
import NonPerm from "../../common/components/nonperm/nonperm";
import { useUserContext } from "../../context/UserContext";
import tabComponentRegistry from "./tabComponentRegistry";

// Clave para persistir el historial de navegación de cada tab en localStorage
const TAB_HISTORIES_KEY = 'tab-histories';

// Historial de navegación en memoria para cada tab.
// Replica la interfaz que React Router usa internamente en MemoryRouter,
// pero sin el componente Router (que lanzaría el error "Router inside Router").
// savedHistory: { entries: string[], index: number } — historial previo (para restaurar tras F5)
function createTabHistory(initialPath, savedHistory) {
    const initEntries = savedHistory?.entries?.length > 0
        ? savedHistory.entries.map(p => ({ ...parsePath(p), state: null, key: 'default' }))
        : [{ ...parsePath(initialPath), state: null, key: 'default' }];
    let entries = initEntries;
    let index = savedHistory?.index !== undefined
        ? Math.min(savedHistory.index, initEntries.length - 1)
        : initEntries.length - 1;
    let listeners = [];
    const notify = (action, location) => listeners.forEach(fn => fn({ action, location }));
    return {
        get location() { return entries[index]; },
        get entries() { return entries; },
        get index() { return index; },
        push(to, state) {
            const base = typeof to === 'string'
                ? { ...parsePath(to), state: state ?? null }
                : { ...to, state: to.state !== undefined ? to.state : (state ?? null) };
            const loc = { ...base, key: Math.random().toString(36).slice(2) };
            entries = [...entries.slice(0, index + 1), loc];
            index = entries.length - 1;
            notify('PUSH', loc);
        },
        replace(to, state) {
            const base = typeof to === 'string'
                ? { ...parsePath(to), state: state ?? null }
                : { ...to, state: to.state !== undefined ? to.state : (state ?? null) };
            const loc = { ...base, key: Math.random().toString(36).slice(2) };
            entries = [...entries.slice(0, index), loc];
            notify('REPLACE', loc);
        },
        go(delta) {
            index = Math.min(Math.max(index + delta, 0), entries.length - 1);
            notify('POP', entries[index]);
        },
        listen(fn) {
            listeners = [...listeners, fn];
            return () => { listeners = listeners.filter(l => l !== fn); };
        },
        createHref(to) { return typeof to === 'string' ? to : (to.pathname || '/'); },
        encodeLocation(to) {
            const p = typeof to === 'string' ? parsePath(to) : to;
            return { pathname: p.pathname || '', search: p.search || '', hash: p.hash || '' };
        },
    };
}

// Router aislado por pestaña: replica internamente lo que hace MemoryRouter+Router
// pero SIN el invariant que prohibe routers anidados.
// Provee UNSAFE_NavigationContext y UNSAFE_LocationContext directamente.
const TabIsolatedRouter = ({ children, initialPath, tabId }) => {
    const historyRef = useRef(null);
    if (!historyRef.current) {
        // Cargar historial guardado del localStorage para poder volver atrás tras F5
        let savedHistory = null;
        try {
            const saved = JSON.parse(localStorage.getItem(TAB_HISTORIES_KEY));
            savedHistory = saved?.[tabId] || null;
        } catch { /* ignorar */ }
        historyRef.current = createTabHistory(initialPath, savedHistory);
    }
    const history = historyRef.current;

    const [locState, setLocState] = useState({
        action: 'POP',
        location: history.location,
    });

    useLayoutEffect(() => history.listen((update) => {
        setLocState(update);
        // Persistir los últimos 3 path del historial para recuperación tras F5
        if (tabId) {
            try {
                const { entries, index } = history;
                const savedEntries = entries
                    .slice(Math.max(0, index - 2), index + 1)
                    .map(e => e.pathname);
                const stored = JSON.parse(localStorage.getItem(TAB_HISTORIES_KEY)) || {};
                stored[tabId] = { entries: savedEntries, index: Math.min(index, 2) };
                localStorage.setItem(TAB_HISTORIES_KEY, JSON.stringify(stored));
            } catch { /* ignorar */ }
        }
    }), [history, tabId]);

    // Limpiar historial guardado cuando la pestaña se cierra (componente desmonta)
    useEffect(() => {
        return () => {
            if (tabId) {
                try {
                    const stored = JSON.parse(localStorage.getItem(TAB_HISTORIES_KEY)) || {};
                    delete stored[tabId];
                    localStorage.setItem(TAB_HISTORIES_KEY, JSON.stringify(stored));
                } catch { /* ignorar */ }
            }
        };
    }, [tabId]);

    const { pathname = '/', search = '', hash = '', state: ls = null, key = 'default' } = locState.location;

    const navCtx = useMemo(() => ({
        basename: '/',
        navigator: history,
        static: false,
        future: {},
    }), [history]);

    const locCtx = useMemo(() => ({
        location: { pathname, search, hash, state: ls, key },
        navigationType: locState.action,
    }), [pathname, search, hash, ls, key, locState.action]);

    // UNSAFE_RouteContext debe resetearse para que Routes no herede los matches
    // del BrowserRouter exterior y pueda hacer matching limpio de las rutas de la tab.
    const emptyRouteCtx = useMemo(() => ({ outlet: null, matches: [], isDataRoute: false }), []);

    return (
        <UNSAFE_NavigationContext.Provider value={navCtx}>
            <UNSAFE_LocationContext.Provider value={locCtx}>
                <UNSAFE_RouteContext.Provider value={emptyRouteCtx}>
                    {children}
                </UNSAFE_RouteContext.Provider>
            </UNSAFE_LocationContext.Provider>
        </UNSAFE_NavigationContext.Provider>
    );
};

// Componente interno del TabIsolatedRouter de cada tab.
// Sincroniza la ubicación interna → TabContext + URL bar.
const TabInternalSync = ({ tabId }) => {
    const memoryLocation = useLocation();     // del MemoryRouter
    const memoryNavigateFn = useNavigate();   // del MemoryRouter
    const { registerTabNavigator, updateTabPath, tabs, activeTabId, findMenuIcon } = useTabContext();

    // Ref estable: evita re-registros en cada render sin perder la referencia actualizada
    const navRef = useRef(memoryNavigateFn);
    useEffect(() => { navRef.current = memoryNavigateFn; });

    // Registrar el navigate de este MemoryRouter en TabContext al montar
    useEffect(() => {
        return registerTabNavigator(tabId, (path) => navRef.current(path));
    }, [tabId, registerTabNavigator]);

    // Sincronizar posición interna del MemoryRouter → TabContext + URL bar
    const tab = tabs.find(t => t.id === tabId);
    useEffect(() => {
        if (!tab || memoryLocation.pathname === tab.path) return; // guard anti-loop

        // Buscar label e ícono para la nueva ruta
        const route = appRoutes.find(r => matchPath({ path: r.path, end: true }, memoryLocation.pathname));
        const newLabel = route?.tabLabel || null;
        const newIcon = findMenuIcon ? findMenuIcon(memoryLocation.pathname) : null;

        updateTabPath(tabId, memoryLocation.pathname, newLabel, newIcon);

        // Actualizar URL bar solo si esta tab es la activa
        if (tabId === activeTabId) {
            window.history.replaceState(null, '', memoryLocation.pathname);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [memoryLocation.pathname]); // deps mínimas: solo reaccionar a cambios de ubicación

    return null;
};

// TabPanels: renderiza todas las tabs simultáneamente con CSS.
// Cada tab tiene su propio MemoryRouter → estado de React siempre preservado.
const TabPanels = () => {
    const { tabs, activeTabId, tabReloadKeys } = useTabContext();
    return (
        <div className="tab-panels">
            {tabs.filter(t => t.type !== 'pinned').map(tab => {
                const isActive = tab.id === activeTabId;

                // Pestaña de componente sin ruta (openComponentTab)
                if (tab.type === 'component') {
                    const Comp = tabComponentRegistry[tab.componentKey];
                    if (!Comp) return null;
                    return (
                        <div key={tab.id} className={`tab-panel ${isActive ? 'active' : ''}`}>
                            <Comp {...(tab.componentProps || {})} />
                        </div>
                    );
                }

                // Pestaña de ruta (nav o pinned): router completamente aislado.
                // TabIsolatedRouter replica MemoryRouter sin el invariant de "Router inside Router".
                return (
                    <div key={tab.id} className={`tab-panel ${isActive ? 'active' : ''}`}>
                        <TabIsolatedRouter key={tabReloadKeys[tab.id] || 0} initialPath={tab.path} tabId={tab.id}>
                            <TabInternalSync tabId={tab.id} />
                            <Routes>
                                {publicRoutes.map(route => (
                                    <Route key={route.path} path={route.path} element={route.element} />
                                ))}
                                <Route element={<MenuGuard />}>
                                    {protectedRoutes.map(route => (
                                        <Route key={route.path} path={route.path} element={route.element} />
                                    ))}
                                </Route>
                            </Routes>
                        </TabIsolatedRouter>
                    </div>
                );
            })}
        </div>
    );
};

const AppRoutes = () => (
    <Routes>
        {publicRoutes.map((route) => (
            <Route key={route.path} path={route.path} element={route.element} />
        ))}

        <Route element={<MenuGuard />}>
            {protectedRoutes.map((route) => (
                <Route key={route.path} path={route.path} element={route.element} />
            ))}
        </Route>
    </Routes>
);

const MainContent = ({ isHovered, menus, canAccessRoute, getActions, menusLoaded }) => {
    const { hasTabs, activeTabId } = useTabContext();
    const { hasPermission, user } = useUserContext();
    const location = useLocation();

    const marginLeft = isOnPhone ? '0px' : isHovered ? '240px' : '40px';
    const showTabs = !isOnPhone;
    const paddingTop = showTabs ? '6rem' : '2rem';
    const shouldShowTabPanels = hasTabs && Boolean(activeTabId);
    // Fase 5 — pasamos `user` para que el helper aplique el bloqueo CLIENTE.
    const canViewRoute = hasRoutePermission(location, { hasPermission, canAccessRoute, getActions, user });

    if (!menusLoaded) return null;

    return (
        <div
            className={`cover-page pt-7 md:pt-6 pr-3 pl-3 md:pr-4 md:pl-4 xl:pr-5 xl:pl-6`}
            style={{ marginLeft, transition: 'margin 0.3s ease', paddingTop }}
        >
            {showTabs && (
                <TabBar
                    isHovered={isHovered}
                    menus={menus}
                    canAccessRoute={canAccessRoute}
                    getActions={getActions}
                />
            )}
            {canViewRoute ? (shouldShowTabPanels ? <TabPanels /> : <AppRoutes />) : <NonPerm />}
        </div>
    );
};

const Cover = () => {
    // Autenticación
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    // Control del sidebar en móvil (Topbar)
    const [sidebarVisible, setSidebarVisible] = useState(false);

    // Estado que controla si el menú está expandido o no (desktop)
    const { isHovered, menus, canAccessRoute, getActions, menusLoaded } = useMenuContext();


    useEffect(() => {
        const verifyToken = async () => {
            const token = localStorage.getItem("token");
            if (!token) {
                setIsAuthenticated(false);
                setLoading(false);
                return;
            }

            try {
                const response = await axios.post(`${config.backendUrl}/api/auth/verify`, {}, {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                });

                if (response.status === 200) {
                    setIsAuthenticated(true);
                } else {
                    setIsAuthenticated(false);
                }
            } catch (error) {
                console.error("Error verificando el token:", error);
                setIsAuthenticated(false);
            } finally {
                setLoading(false);
            }
        };

        verifyToken();
    }, []);


    // Standalone public routes (no navbar, no auth)
    const isStandalone = standaloneRoutes.some(r => {
        const pattern = r.path.replace(/:[^/]+/g, '[^/]+');
        return new RegExp(`^${pattern}$`).test(window.location.pathname);
    });

    if (isStandalone) {
        return (
            <Router>
                <Routes>
                    {standaloneRoutes.map((route) => (
                        <Route key={route.path} path={route.path} element={route.element} />
                    ))}
                </Routes>
            </Router>
        );
    }

    if (loading) {
        return (
            <div className="cover-container w-full h-full flex align-self-center justify-content-center">
                <LoadSpinner />
            </div>
        );
    }

    return (
        <div className="cover-container pt-0 flex flex-column w-full align-items-center w-full max-width-100">
            {isAuthenticated ? (
                <Router>
                    <TabProvider>
                        {/* TOPBAR se ve en modo teléfono */}
                        <div className="w-full phone-show">
                            <Topbar visible={sidebarVisible} setVisible={setSidebarVisible} />
                        </div>

                        {/* Contenido principal */}
                        <div className="flex w-full">
                            {/* Navbar (sidebar en desktop) */}
                            <Navbar
                                visible={sidebarVisible}
                                setVisible={setSidebarVisible}
                            />

                            {/* Contenedor principal de la app, ajusta su margin-left */}
                            <MainContent
                                isHovered={isHovered}
                                menus={menus}
                                canAccessRoute={canAccessRoute}
                                getActions={getActions}
                                menusLoaded={menusLoaded}
                            />
                        </div>
                    </TabProvider>
                </Router>
            ) : (
                <Login />
            )}
        </div>
    );
};

export default Cover;
