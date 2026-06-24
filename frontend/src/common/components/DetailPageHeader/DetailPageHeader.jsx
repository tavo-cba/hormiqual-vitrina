import React from 'react';
import { Button } from 'primereact/button';
import './DetailPageHeader.css';

/**
 * DetailPageHeader — header para páginas de detalle/formulario.
 *
 * Diferencia con `PageHeader` (que es para páginas-menú): este componente
 * está pensado para hojas de navegación (detalle de recurso, formulario de
 * creación/edición). Tiene back-button visible, ícono opcional, título +
 * subtítulo, y un slot de acciones a la derecha (botones Editar / Certificar
 * / Volver a listado / etc.).
 *
 * @param {string}    icon       Clase Font Awesome (opcional). Si no se pasa, no se renderiza el círculo.
 * @param {string}    title      Título principal (ej: "Filler", "Editar Material", "Detalle Set").
 * @param {string|node} subtitle Subtítulo (ej: "Loma Negra", "Cemento — CPF40", o un nodo con badges).
 * @param {function}  onBack     Handler del botón ←. Default: window.history.back().
 * @param {boolean}   showBack   Mostrar back-button. Default: true.
 * @param {node}      actions    Botones / contenido a la derecha (ej: <><Button label="Editar"/></>).
 * @param {string}    className  Clase adicional opcional.
 * @param {object}    iconStyle  Estilos inline para el ícono (color personalizado).
 */
const DetailPageHeader = ({
    icon,
    title,
    subtitle,
    onBack,
    showBack = true,
    actions,
    className = '',
    iconStyle = {},
}) => {
    const handleBack = (e) => {
        if (e?.currentTarget?.blur) e.currentTarget.blur();
        if (onBack) onBack();
        else window.history.back();
    };

    return (
        <div className={`detail-page-header ${className}`}>
            <div className="detail-page-header-left">
                {showBack && (
                    <Button
                        type="button"
                        icon="fa-solid fa-arrow-left"
                        className="detail-page-header-back p-button-text"
                        onClick={handleBack}
                        tooltip="Volver"
                        tooltipOptions={{ position: 'bottom', showDelay: 300 }}
                        aria-label="Volver"
                    />
                )}
                {icon && (
                    <div className="detail-page-header-icon" style={iconStyle}>
                        <i className={icon} />
                    </div>
                )}
                <div className="detail-page-header-text">
                    <h2>{title}</h2>
                    {subtitle && <div className="detail-page-header-subtitle">{subtitle}</div>}
                </div>
            </div>
            {actions && (
                <div className="detail-page-header-actions">
                    {actions}
                </div>
            )}
        </div>
    );
};

export default DetailPageHeader;
