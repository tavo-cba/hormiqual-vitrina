import React from 'react';
import './SectorCostoOption.css';

/**
 * Construye las options enriquecidas para Dropdown/MultiSelect de SectorCosto.
 * Spread-ea el objeto original para que los templates tengan acceso a vehiculo/fuenteCombustible.
 */
export const buildSectorOptions = (sectores) =>
    (Array.isArray(sectores) ? sectores : []).map((s) => ({
        ...s,
        label: s.nombre,
        value: s.idSectorCosto ?? s.id,
    }));

/**
 * itemTemplate para el listado abierto del Dropdown/MultiSelect.
 * Layout: texto principal arriba, badges abajo.
 */
export const sectorOptionTemplate = (option) => {
    if (!option) return null;

    if (option.vehiculo) {
        const v = option.vehiculo;
        const mainParts = [v.patente, v.interno].filter(Boolean);
        const subParts = [v.marca, v.modelo].filter(Boolean);
        return (
            <div className="sc-option">
                <div className="sc-option__row">
                    <span className="sc-option__main">
                        {mainParts.length > 0 ? mainParts.join(' · ') : option.nombre}
                    </span>
                    {subParts.length > 0 && (
                        <span className="sc-option__sub">{subParts.join(' ')}</span>
                    )}
                </div>
                <span className="sc-badge sc-badge--vehiculo">
                    <i className="fa-solid fa-truck" />
                    {v.categoria?.nombre || 'Vehículo'}
                </span>
            </div>
        );
    }

    if (option.fuenteCombustible) {
        const f = option.fuenteCombustible;
        const mainParts = [f.detalle, f.interno].filter(Boolean);
        return (
            <div className="sc-option">
                <div className="sc-option__row">
                    <span className="sc-option__main">
                        {mainParts.length > 0 ? mainParts.join(' · ') : option.nombre}
                    </span>
                </div>
                <div className="sc-option__badges">
                    <span className="sc-badge sc-badge--fuente">
                        <i className="fa-solid fa-gas-pump" />
                        {f.categoria?.categoria || 'Fuente'}
                    </span>
                    {f.tipoCombustible && (
                        <span className="sc-badge sc-badge--combustible">
                            <i className="fa-solid fa-droplet" />
                            {f.tipoCombustible}
                        </span>
                    )}
                </div>
            </div>
        );
    }

    return <span>{option.nombre || option.label}</span>;
};

/**
 * valueTemplate para el valor seleccionado (dropdown cerrado).
 * Más compacto: una sola línea con badge inline.
 */
export const sectorValueTemplate = (option, props) => {
    if (!option) return <span>{props?.placeholder}</span>;

    if (option.vehiculo) {
        const v = option.vehiculo;
        const parts = [v.patente, v.interno].filter(Boolean);
        return (
            <div className="sc-value">
                <span className="sc-badge sc-badge--vehiculo sc-badge--sm">
                    <i className="fa-solid fa-truck" />
                    {v.categoria?.nombre || 'Veh.'}
                </span>
                <span className="sc-value__text">
                    {parts.length > 0 ? parts.join(' · ') : option.nombre}
                </span>
            </div>
        );
    }

    if (option.fuenteCombustible) {
        const f = option.fuenteCombustible;
        return (
            <div className="sc-value">
                <span className="sc-badge sc-badge--fuente sc-badge--sm">
                    <i className="fa-solid fa-gas-pump" />
                    {f.categoria?.categoria || 'Fuente'}
                </span>
                <span className="sc-value__text">
                    {f.detalle || option.nombre}
                </span>
            </div>
        );
    }

    return <span>{option.nombre || option.label}</span>;
};
