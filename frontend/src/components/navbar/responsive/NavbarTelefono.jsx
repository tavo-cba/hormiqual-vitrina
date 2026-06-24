// src/components/navbar/NavbarTelefono.jsx
import React, { useState, useContext } from "react";
import '../navbar.css';
import { Sidebar } from "primereact/sidebar";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Accordion, AccordionTab } from "primereact/accordion";
import { isOnPhone } from "../../../common/functions";
import defaultLogo from '../../../assets/img/logo.png';
// [VITRINA] Logos por tema (la tabla Config no trae logoLink/logoLightLink).
import logoDark from '../../../assets/img/logo-dark.png';
import logoLight from '../../../assets/img/logo-light.png';
import { useConfig } from "../../../context/ConfigContext";
import { menuGroups } from "../data/menuConifg";
import { useMenuContext } from "../../../context/MenuContext";
import { ThemeContext } from "../../../context/ThemeContext";

// hooks
import { useUserContext } from "../../../context/UserContext";

const NavbarTelefono = ({ visible, setVisible }) => {
  const [activeIndex, setActiveIndex] = useState(null);
  const [openAccordions, setOpenAccordions] = useState({});
  const { hasPermission } = useUserContext();
  const { menus } = useMenuContext();
  const cfg = useConfig();
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useContext(ThemeContext);

  const logoSrc = (isDark
    ? (cfg?.logoLink)
    : (cfg?.logoLightLink || cfg?.logoLink)) || (isDark ? logoDark : logoLight);

  const handleTabChange = (e) => setActiveIndex(e.index);

  const logout = () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  const toggleSidebar = () => setVisible(prev => !prev);

  const navigateHome = () => {
    toggleSidebar();
    setActiveIndex(null);
    setOpenAccordions({}); // Cerrar todos los acordeones anidados
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
          className="subnav-button block w-full mb-1"
          onClick={navigateHome}
        >
          <i className={`${item.icono} mr-2`} />
          {item.nombre}
        </Link>
      );
    }

    return (
      <Accordion
        key={item.idMenu}
        className="nested-accordion w-full"
        activeIndex={isOpen ? 0 : -1}
        onTabChange={() => toggleAccordion(item.idMenu)}
      >
        <AccordionTab
          header={
            <span
              className="p-0 mx-2"
              style={{ fontSize: '0.8rem', fontWeight: '300' }}
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

  return (
    <Sidebar
      visible={visible}
      onHide={toggleSidebar}
      modal={false}
      dismissable={false}
      showCloseIcon={false}
      className="w-full"
      id="phone-sidebar"
    >
      <div className="flex flex-column w-full h-full justify-content-between align-items-center pt-1 xl:pt-3">

        <div className="flex flex-column w-full align-items-center ">
          <div className="flex justify-content-between xl:pl-2 w-full pb-4 align-items-center">
            <Link
              to={'/'}
              style={{ textDecoration: 'none', color: 'inherit' }}
              className="flex flex-column"
              onClick={navigateHome}
            >
              <img src={logoSrc} className="sidebar-logo" alt="Logo" />
            </Link>

            {isOnPhone && (
              <i
                className="fa-solid fa-circle-arrow-left phone-show pt-1"
                onClick={toggleSidebar}
                style={{ fontSize: '1.5rem', cursor: 'pointer' }}
              />
            )}
          </div>

          <div className="card flex flex-column align-items-center w-full">
            <Accordion
              className="w-12 xl:w-full"
              onTabChange={handleTabChange}
              activeIndex={activeIndex}
              expandIcon='fa-solid fa-caret-right'
              collapseIcon='fa-solid fa-caret-down'
              id="nav-accordion"
            >
              {menus.map(group => (
                <AccordionTab
                  key={group.idMenu}
                  header={<span><i className={`${group.icono} mr-2`} />{group.nombre}</span>}
                  className="w-full pb-1"
                >
                  <div className="flex flex-column">
                    {group.children && group.children.map(el => renderItem(el, true))}
                  </div>
                </AccordionTab>
              ))}
            </Accordion>
          </div>
        </div>

        <div className="flex flex-row justify-content-center gap-2 w-full pb-3 pt-2">
          {cfg?.whatsappSoporte && (
            <Button
              className="nav-icon-btn"
              onClick={() => window.open(`https://wa.me/${cfg.whatsappSoporte}`, '_blank')}
              tooltip="Soporte técnico"
              tooltipOptions={{ position: 'top', className: 'nav-tooltip' }}
            >
              <i className="fa-solid fa-headset" style={{ fontSize: '1.1rem' }} />
            </Button>
          )}

          {/* Alertas de calidad y tema (claro/oscuro): migrados a Configuración → Preferencias (2026-05-13). */}

          <Button
            className="nav-icon-btn"
            onClick={logout}
            tooltip="Cerrar sesión"
            tooltipOptions={{ position: 'top', className: 'nav-tooltip' }}
          >
            <i className="fa-solid fa-right-from-bracket" style={{ fontSize: '1.1rem' }} />
          </Button>
        </div>
      </div>
    </Sidebar>
  );
};

export default NavbarTelefono;
