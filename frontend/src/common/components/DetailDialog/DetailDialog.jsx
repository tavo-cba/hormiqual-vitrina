import React from "react";
import "./DetailDialog.css";

export const formatNumberLocale = (n) => {
    if (n == null) return null;
    const num = Number(n);
    if (Number.isNaN(num)) return String(n);
    return num.toLocaleString('es-AR');
};

export const DialogHeader = ({ icon, title, status, statusAccent }) => (
    <div className="dd-header">
        <div className="dd-header-title">
            {icon && <i className={icon} />}
            <span>{title}</span>
        </div>
        {status && (
            <span className={`dd-status accent-${statusAccent || 'neutral'}`}>
                {status}
            </span>
        )}
    </div>
);

export const StatusPill = ({ icon, label, accent = 'neutral' }) => (
    <span className={`dd-status accent-${accent}`}>
        {icon && <i className={icon} />}
        {label}
    </span>
);

export const VehicleHero = ({ vehiculo, icon = 'fa-solid fa-truck-pickup' }) => {
    if (!vehiculo) return null;
    const patente = vehiculo.patente;
    const interno = vehiculo.interno;
    const identifier = patente || (interno != null && String(interno).trim() !== '' ? `Interno ${interno}` : 'Sin identificación');
    return (
        <div className="dd-hero">
            <div className="dd-hero-icon">
                <i className={icon} />
            </div>
            <div className="dd-hero-info">
                <div className="dd-hero-title">{identifier}</div>
                <div className="dd-hero-meta">
                    {vehiculo.marca && <span>{vehiculo.marca}</span>}
                    {vehiculo.modelo && <span>{vehiculo.modelo}</span>}
                    {patente && interno != null && String(interno).trim() !== '' && (
                        <span className="dd-hero-tag">Interno {interno}</span>
                    )}
                </div>
            </div>
        </div>
    );
};

export const PersonHero = ({
    nombre = '',
    apellido = '',
    subtitle,
    icon = 'fa-solid fa-user',
}) => {
    const initials = `${(nombre[0] || '').toUpperCase()}${(apellido[0] || '').toUpperCase()}` || '?';
    return (
        <div className="dd-hero">
            <div className="dd-hero-icon dd-hero-icon-person">
                {initials || <i className={icon} />}
            </div>
            <div className="dd-hero-info">
                <div className="dd-hero-title">{`${nombre} ${apellido}`.trim() || 'Sin nombre'}</div>
                {subtitle && <div className="dd-hero-meta"><span>{subtitle}</span></div>}
            </div>
        </div>
    );
};

export const InfoStat = ({ icon, label, value, hint, accent }) => (
    <div className={`dd-stat ${accent ? `accent-${accent}` : ''}`}>
        <div className="dd-stat-icon"><i className={icon} /></div>
        <div className="dd-stat-body">
            <small className="dd-stat-label">{label}</small>
            <span className="dd-stat-value">{value}</span>
            {hint && <small className="dd-stat-hint">{hint}</small>}
        </div>
    </div>
);

export const StatsGrid = ({ children }) => (
    <div className="dd-stats">{children}</div>
);

export const DetailSection = ({ icon, title, children, action }) => (
    <div className="dd-section">
        <div className="dd-section-title">
            <span className="dd-section-title-text">
                {icon && <i className={icon} />}
                <span>{title}</span>
            </span>
            {action}
        </div>
        <div className="dd-section-body">{children}</div>
    </div>
);

export const Callout = ({ icon = 'fa-solid fa-circle-info', accent = 'info', children }) => (
    <div className={`dd-callout accent-${accent}`}>
        <i className={icon} />
        <span>{children}</span>
    </div>
);

export const NoteBlock = ({ children }) => (
    <div className="dd-note">{children}</div>
);

export const DetailContainer = ({ children }) => (
    <div className="dd-container">{children}</div>
);

export const NumberedList = ({ items = [], renderItem }) => {
    if (!items.length) return null;
    return (
        <ul className="dd-numbered-list">
            {items.map((item, i) => (
                <li key={item.id || item.key || i} className="dd-numbered-item">
                    <span className="dd-numbered-num">{i + 1}</span>
                    <span className="dd-numbered-text">
                        {renderItem ? renderItem(item, i) : item.label || String(item)}
                    </span>
                </li>
            ))}
        </ul>
    );
};

export const EmptyState = ({ icon = 'fa-solid fa-inbox', children }) => (
    <div className="dd-empty">
        <i className={icon} />
        <span>{children}</span>
    </div>
);
