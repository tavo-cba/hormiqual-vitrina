import React from "react";
import "./EntityTabs.css";

/**
 * Sistema de pestañas con estética de mantenimiento.jsx (subtabs con underline animado).
 *
 * Uso:
 *   <EntityTabs
 *     activeIndex={activeTab}
 *     onTabChange={setActiveTab}
 *     tabs={[
 *       { key: 'info', label: 'Información', icon: 'fa-solid fa-circle-info' },
 *       { key: 'orders', label: 'Órdenes', icon: 'fa-solid fa-file-contract', count: 12 },
 *     ]}
 *   />
 *   <div>{tabs[activeTab].key === 'info' && <InfoPanel />}</div>
 *
 * El contenedor renderiza únicamente la barra de pestañas; el contenido lo manejás afuera.
 */
const EntityTabs = ({ tabs = [], activeIndex = 0, onTabChange, ariaLabel = "Pestañas" }) => {
    if (!Array.isArray(tabs) || tabs.length === 0) return null;
    return (
        <div className="entity-tabs" role="tablist" aria-label={ariaLabel}>
            {tabs.map((tab, idx) => {
                if (!tab) return null;
                const isActive = idx === activeIndex;
                return (
                    <button
                        key={tab.key ?? idx}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`entity-tab ${isActive ? "active" : ""}`}
                        onClick={() => onTabChange && onTabChange(idx)}
                        title={tab.description || undefined}
                    >
                        {tab.icon && <i className={tab.icon} aria-hidden="true"></i>}
                        <span className="entity-tab-label">{tab.label}</span>
                        {tab.loading
                            ? <i className="fa-solid fa-circle-notch fa-spin entity-tab-spinner" />
                            : (tab.count != null
                                ? <span className="entity-tab-badge">{tab.count}</span>
                                : null)
                        }
                    </button>
                );
            })}
        </div>
    );
};

export default EntityTabs;
