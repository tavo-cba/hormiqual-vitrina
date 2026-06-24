import React, { useContext } from "react";
import './topbar.css';
import { isOnPhone } from "../../common/functions";
import { useConfig } from "../../context/ConfigContext";
import { ThemeContext } from "../../context/ThemeContext";
import { Link } from "react-router-dom";

const Topbar = ({ visible, setVisible }) => {
    const cfg = useConfig();
    const { isDark } = useContext(ThemeContext);
    const logoSrc = isDark
        ? (cfg?.logoLink)
        : (cfg?.logoLightLink || cfg?.logoLink);
    return (
        <div className="topbar-container flex justify-content-between align-items-center pl-3 pr-3 ">
            <Link to={'/'} style={{ textDecoration: 'none', color: 'inherit' }} className="flex flex-column">
                <img src={logoSrc} onClick={() => window.href = "/"} className="topbar-logo" />
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