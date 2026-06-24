// src/components/navbar/NavbarPC.jsx
import React, { useState, useRef, useEffect, useContext } from "react";
import '../navbar.css';
import { Sidebar } from "primereact/sidebar";
import { Link, useLocation } from "react-router-dom";
import { Button } from "primereact/button";
import { Accordion, AccordionTab } from "primereact/accordion";
import { Tooltip } from "primereact/tooltip";
import { isOnPhone } from "../../../common/functions";
import defaultLogo from '../../../assets/img/logo.png';
import defaultSmallLogo from '../../../assets/img/smallogo.png';
import { useConfig } from "../../../context/ConfigContext";
import { menuGroups } from "../data/menuConifg";
import { ThemeContext } from "../../../context/ThemeContext";

// hooks
import { useMenuContext } from "../../../context/MenuContext";
import { useUserContext } from "../../../context/UserContext";
import { useTabContext } from "../../../context/TabContext";

// PR3: tooltips extendidos para módulos cuyo label corto no es autoexplicativo.
// Si un grupo de menú tiene `modulo` en este mapa, su tooltip lo combina en
// "Nombre — Descripción" en lugar de mostrar solo el nombre.
const MODULO_TOOLTIPS = {
  tbs: 'Tratamientos Bituminosos Superficiales (Vialidad)',
};

const NavbarPC = ({ visible, setVisible }) => {
  const [activeIndex, setActiveIndex] = useState(null);
  const [openAccordions, setOpenAccordions] = useState({});
  const { isHovered, showText, toggleMenu, menus, openMenu, closeMenu } = useMenuContext();
  const [blockUi, setBlockUi] = useState(false);
  const { hasPermission } = useUserContext();
  const { openFavoriteTab, openNewTab, navigateActive, hasTabs } = useTabContext();
  const cfg = useConfig();
  const { isDark, toggleTheme } = useContext(ThemeContext);

  const logoSrc = isDark
    ? (cfg?.logoLink)
    : (cfg?.logoLightLink || cfg?.logoLink);
  const smallLogoSrc = cfg?.logoLink || defaultSmallLogo;

  const menuTooltipRef = useRef(null);
  const openTooltipRef = useRef(null);
  const location = useLocation();

  const hideTooltips = () => {
    menuTooltipRef.current?.hide();
    openTooltipRef.current?.hide();
    setTimeout(() => setBlockUi(false), 500);
  };

  useEffect(() => {
    hideTooltips();
  }, [location.pathname]);

  // Preferencia: auto-abrir el menú al pasar el mouse.
  //
  // Atado vía native listeners porque PrimeReact filtra los props
  // `onMouseEnter`/`onMouseLeave` del componente `<Sidebar>`. Reintenta
  // hasta 20 veces (cada 100ms) por si el Sidebar todavía no se montó
  // cuando corre el effect.
  useEffect(() => {
    if (isOnPhone) return;

    let cleanup = null;
    let attempts = 0;
    let interval = null;

    const tryAttach = () => {
      const el = document.getElementById('nav-sidebar');
      if (!el) return false;

      const onEnter = () => {
        if (localStorage.getItem('menuAutoOpenHover') !== '1') return;
        if (el.classList.contains('expanded')) return;
        openMenu(false);
      };
      const onLeave = () => {
        if (localStorage.getItem('menuAutoOpenHover') !== '1') return;
        if (localStorage.getItem('menu') === '1') return;
        if (!el.classList.contains('expanded')) return;
        closeMenu(false);
      };

      el.addEventListener('mouseenter', onEnter);
      el.addEventListener('mouseleave', onLeave);
      cleanup = () => {
        el.removeEventListener('mouseenter', onEnter);
        el.removeEventListener('mouseleave', onLeave);
      };
      return true;
    };

    if (!tryAttach()) {
      interval = setInterval(() => {
        attempts++;
        if (tryAttach() || attempts > 20) {
          clearInterval(interval);
          interval = null;
        }
      }, 100);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (cleanup) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleContextMenu = (event, item) => {
    event.preventDefault();
    if (item?.ruta) {
      openFavoriteTab(item.ruta, item.nombre);
    }
  };

  const toggleAccordion = (menuId) => {
    setOpenAccordions(prev => ({
      ...prev,
      [menuId]: !prev[menuId]
    }));
  };

  const renderItem = (item, hasParent = false) => {
    const hasChildren = item.children && item.children.length > 0;
    const isOpen = openAccordions[item.idMenu];

    if (!hasChildren) {
      return (
        <Link
          key={item.idMenu}
          to={item.ruta || '#'}
          className="subnav-button block w-full mb-1 menu-title-tooltip"
          onClick={(e) => {
            e.preventDefault();
            navigateHome();
            if (item.ruta) navigateActive(item.ruta, item.nombre);
          }}
          onContextMenu={(event) => handleContextMenu(event, item)}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              if (item.ruta) openNewTab(item.ruta, item.nombre);
            }
          }}
        >
          <i className={`${item.icono} mr-2`} />
          {item.nombre}
        </Link>
      );
    }

    return (
      <Accordion
        key={item.idMenu}
        className="nested-accordion w-full p-0 m-0"
        activeIndex={isOpen ? 0 : -1}
        onTabChange={() => toggleAccordion(item.idMenu)}
      >
        <AccordionTab
          header={
            <span
              className="p-0 m-2 menu-title-tooltip"
              style={{ fontSize: '0.8rem', fontWeight: '300' }}
              // Preferencia: auto-abrir el sub-grupo al pasar el mouse.
              onMouseEnter={() => {
                if (localStorage.getItem('menuAutoOpenHover') !== '1') return;
                if (isOpen) return;
                setOpenAccordions((prev) => ({ ...prev, [item.idMenu]: true }));
              }}
            >
              {hasParent && (
                <i
                  className={`fa-solid ${isOpen ? 'fa-caret-down' : 'fa-caret-right'}`}
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-color-secondary)',
                    marginRight: '0.5rem',
                    transition: 'transform 0.2s ease'
                  }}
                />
              )}
              <i className={`${item.icono} mr-2`} />
              {item.nombre}
            </span>
          }
        >
          {item.children.map((child) => renderItem(child, true))}
        </AccordionTab>
      </Accordion>
    );
  };

  const navigateHome = () => {
    setBlockUi(true);
    hideTooltips();
    setVisible(false);
    // Configuración → Preferencias: si el user activó "mantener menú expandido",
    // NO cerramos los acordeones (ni los top-level vía `activeIndex`, ni los
    // anidados vía `openAccordions`) ni el sidebar al navegar a un item.
    const mantenerExpandido = localStorage.getItem('menuMantenerExpandido') === '1';
    if (!mantenerExpandido) {
      setActiveIndex(null);
      setOpenAccordions({});
      if (localStorage.getItem('menu') === '0') {
        closeMenu(false);
      }
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  const toggleSidebar = () => setVisible(v => !v);
  const handleTabChange = e => setActiveIndex(e.index);

  return (
    <div>
      <Tooltip target=".open-menu-tooltip" style={{display: blockUi ? 'none' : ''}} />
      <Sidebar
        id="nav-sidebar"
        visible={isOnPhone ? visible : true}
        onHide={toggleSidebar}
        modal={false}
        dismissable={false}
        showCloseIcon={false}
        onContextMenu={(event) => event.preventDefault()}
        className={`nav-sidebar ${isHovered ? "expanded" : "collapsed pt-2"}`}
      >
        <div className="flex flex-column w-full h-full" style={{ paddingTop: '45px' }}>

          {/* ─── Header / Logo ─── */}
          <div className="flex flex-column w-full align-items-center flex-shrink-0">
            <div className="flex justify-content-between xl:justify-content-center w-full pb-4 align-items-center">
              <Link
                to="/"
                className="flex flex-column"
                style={{ textDecoration: 'none', color: 'inherit' }}
                onClick={(e) => {
                  e.preventDefault();
                  navigateHome();
                  navigateActive('/');
                }}
              >
                {isHovered
                  ? (
                    <div className="w-full flex flex-column">
                      <img src={logoSrc} className="sidebar-logo" alt="Logo" />

                    </div>
                  )
                  : (
                    <div className="w-full flex justify-content-center pb-4" style={{ maxWidth: '50px' }}>
                      <img src={cfg?.thumbnail} width="60%" alt="Logo" />
                    </div>
                  )}
              </Link>
            </div>
          </div>

          {/* ─── Scrollable Menu Area ─── */}
          <div className="flex flex-column w-full align-items-center nav-scroll-area">

            {/* ─── Accordion Menu ─── */}
            <div className="card flex flex-column align-items-center w-full justify-content-center">
              <Accordion
                className={`w-full flex flex-column ${isHovered ? 'pl-3 pr-3' : 'align-items-center'}`}
                onTabChange={handleTabChange}
                activeIndex={activeIndex}
                expandIcon="fa-solid fa-caret-right"
                collapseIcon="fa-solid fa-caret-down"
                id="nav-accordion"
              >
                {menus.map((group, index) => {
                  const tooltipExtra = MODULO_TOOLTIPS[group.modulo];
                  const tooltipText = tooltipExtra
                    ? `${group.nombre} — ${tooltipExtra}`
                    : group.nombre;
                  return (
                  <AccordionTab
                    key={group.idMenu}
                    id={`group${index}`}
                    header={
                      <span
                        className="flex align-items-center w-full"
                        // Preferencia: auto-expandir el grupo al pasar el mouse.
                        // Solo se ejecuta cuando el sidebar ya está abierto
                        // (showText && isHovered); cuando está colapsado, el
                        // hover sobre el ícono primero expande el sidebar.
                        onMouseEnter={() => {
                          if (localStorage.getItem('menuAutoOpenHover') !== '1') return;
                          if (!showText || !isHovered) return;
                          if (activeIndex === index) return;
                          setActiveIndex(index);
                        }}
                      >
                        <i
                          className={`${group.icono} ml-1 menu-title-tooltip`}
                          style={{ fontSize: '1rem' }}
                          data-pr-tooltip={tooltipText}
                          data-pr-position="right"
                        />
                        {showText && isHovered && (
                          <span className="ml-2 pl-1">
                            {group.nombre}
                          </span>
                        )}
                        <Tooltip target={`#group${index}`} key={`open-${location.pathname}`} ref={openTooltipRef} style={{display: !showText && !isHovered  ? '' : 'none'}} className="nav-tooltip">{tooltipText}</Tooltip>
                      </span>
                    }
                    className="w-full"
                    onClick={isHovered ? null : () => openMenu(false)}
                  >
                    {showText && isHovered && (
                      <div className="flex flex-column">
                        {group.children && group.children.map(item => renderItem(item, true))}
                      </div>
                    )}
                  </AccordionTab>
                  );
                })}
              </Accordion>
            </div>
          </div>

          {/* ─── Footer ─── */}
          <div className={`flex w-full flex-shrink-0 ${isHovered ? 'flex-row justify-content-center gap-2 pb-3 pt-2' : 'flex-column align-items-center gap-2 pb-3 pt-1'}`}>
            {cfg?.whatsappSoporte && (
              <Button
                className="nav-icon-btn"
                onClick={() => window.open(`https://wa.me/${cfg.whatsappSoporte}`, '_blank')}
                tooltip="Soporte técnico"
                tooltipOptions={{ position: 'bottom', className: 'nav-tooltip' }}
              >
                <i className="fa-solid fa-headset" style={{ fontSize: '1.1rem' }} />
              </Button>
            )}

            {/* Alertas de calidad y tema (claro/oscuro): migrados a Configuración → Preferencias (2026-05-13). */}

            <Button
              className="nav-icon-btn"
              onClick={toggleMenu}
              tooltip={isHovered ? 'Plegar menú' : 'Desplegar menú'}
              tooltipOptions={{ position: 'bottom', className: 'nav-tooltip' }}
            >
              <i className={`fa-solid ${isHovered ? 'fa-arrow-left' : 'fa-arrow-right'}`} style={{ fontSize: '1.1rem' }} />
            </Button>

            <Button
              className="nav-icon-btn"
              onClick={logout}
              tooltip="Cerrar sesión"
              tooltipOptions={{ position: 'bottom', className: 'nav-tooltip' }}
            >
              <i className="fa-solid fa-right-from-bracket" style={{ fontSize: '1.1rem' }} />
            </Button>
          </div>

        </div>
      </Sidebar>
    </div>
  );
};

export default NavbarPC;
