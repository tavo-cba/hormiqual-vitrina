import React, { useRef } from 'react';
import { Button } from 'primereact/button';
import { useNavigate, useLocation } from 'react-router-dom';
import './PageHeader.css';

/**
 * PageHeader - Componente reutilizable para headers de páginas
 *
 * @param {string} icon - Clase del ícono Font Awesome (ej: "fa-solid fa-calendar-check")
 * @param {string} title - Título de la página
 * @param {string} subtitle - Subtítulo descriptivo
 * @param {string} className - Clase CSS adicional (opcional)
 * @param {object} iconStyle - Estilos inline para el ícono (opcional, para colores personalizados)
 * @param {boolean} showBack - Mostrar botón de volver (default: true)
 * @param {string} backTo - Ruta destino al volver (opcional). Si no se provee usa navigate(-1).
 * @param {function} onBack - Handler custom (sobreescribe todo).
 */
const PageHeader = ({
    icon,
    title,
    subtitle,
    className = '',
    iconStyle = {},
    showBack = true,
    backTo,
    onBack
}) => {
    const navigate = useNavigate();
    const location = useLocation();
    const lastClickRef = useRef(0);

    const handleBack = (e) => {
        if (e?.currentTarget?.blur) {
            e.currentTarget.blur();
        }

        // Debounce: ignorar clicks más rápidos que 250ms entre sí (evita dobles clicks accidentales)
        const now = Date.now();
        if (now - lastClickRef.current < 250) return;
        lastClickRef.current = now;

        if (onBack) {
            onBack();
            return;
        }

        if (backTo) {
            navigate(backTo);
            return;
        }

        // Guardar path actual; si después de navigate(-1) seguimos en la misma ruta,
        // significa que no hay historia hacia atrás → fallback al padre (strip último segmento).
        const prevPath = location.pathname;
        navigate(-1);
        setTimeout(() => {
            if (window.location.pathname === prevPath) {
                const parent = prevPath.replace(/\/[^/]+\/?$/, '') || '/';
                if (parent !== prevPath) navigate(parent, { replace: true });
            }
        }, 50);
    };

    return (
        <div className={`page-header ${className}`}>
            <div className="page-header-content">
                {showBack && (
                    <Button
                        type="button"
                        icon="fa-solid fa-arrow-left"
                        className="page-header-back p-button-text"
                        onClick={handleBack}
                        tooltip="Volver"
                        tooltipOptions={{
                            position: 'bottom',
                            showDelay: 300,
                            hideDelay: 0,
                            className: 'page-header-back-tooltip'
                        }}
                        aria-label="Volver"
                    />
                )}
                <div className="page-header-icon" style={iconStyle}>
                    <i className={icon} />
                </div>
                <div className="page-header-text">
                    <h1>{title}</h1>
                    <p>{subtitle}</p>
                </div>
            </div>
        </div>
    );
};

export default PageHeader;
