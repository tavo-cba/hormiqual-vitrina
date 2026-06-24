import React, { useContext } from "react";
import './topbar.css';
import { isOnPhone } from "../../common/functions";
import { useConfig } from "../../context/ConfigContext";
import { ThemeContext } from "../../context/ThemeContext";
import { Link } from "react-router-dom";
// [VITRINA] Logos por defecto, uno por tema. En la vitrina la tabla Config no
// trae logoLink/logoLightLink (los logos del tenant se cargan por Configuración),
// así que sin estos fallbacks el <img> queda roto. El logo se adapta al tema:
//   - logo-dark.png  → se usa con TEMA OSCURO (debe ser un logo claro/blanco).
//   - logo-light.png → se usa con TEMA CLARO  (debe ser un logo oscuro).
import logoDark from "../../assets/img/logo-dark.png";
import logoLight from "../../assets/img/logo-light.png";

const Topbar = ({ visible, setVisible }) => {
    const cfg = useConfig();
    const { isDark } = useContext(ThemeContext);
    const fallback = isDark ? logoDark : logoLight;
    const logoSrc = (isDark
        ? (cfg?.logoLink)
        : (cfg?.logoLightLink || cfg?.logoLink)) || fallback;
    return (
        <div className="topbar-container flex justify-content-between align-items-center pl-3 pr-3 ">
            <Link to={'/'} style={{ textDecoration: 'none', color: 'inherit' }} className="flex flex-column">
                <img
                    src={logoSrc}
                    alt="HormiQual"
                    onClick={() => window.href = "/"}
                    onError={(e) => { if (!e.target.src.endsWith(fallback)) e.target.src = fallback; }}
                    className="topbar-logo"
                />
            </Link>
            {isOnPhone && (
                <span
                    onClick={() => setVisible(true)}
                ><i className="fa-solid fa-bars mr-3"></i></span>
            )}
        </div>
    )
}
export default Topbar;