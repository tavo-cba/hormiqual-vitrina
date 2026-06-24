import React, { useState, useMemo, useCallback } from "react";
import "./home.css";
import { Fade } from "react-awesome-reveal";
import { Link } from "react-router-dom";
import { useUserContext } from "../../context/UserContext";
import { useConfig } from "../../context/ConfigContext";
import HomeCompromisosCard from "./HomeCompromisosCard";
import HomeObligacionesCard from "./HomeObligacionesCard";
import { useHomeAlerts } from "./useHomeAlerts";

const AREA_FILTER_KEY = 'home-area-filter';

/* Fecha legible en español: "Jueves 22 de mayo" */
const fechaLarga = () => {
  const t = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/* Una fila de alerta — enlace a su pantalla destino. */
const AlertRow = ({ item, showCategoria }) => (
  <Link
    to={item.to}
    className={`home-alert-row ${item.severity ? `home-alert-${item.severity}` : ''}`}
  >
    <div className="home-alert-icon">
      <i className={item.icon} />
    </div>
    <span className="home-alert-text">{item.text}</span>
    {showCategoria && (
      <span className="home-alert-cat">
        <i className={item.categoryIcon} />
        {item.category}
      </span>
    )}
    <i className="fa-solid fa-chevron-right home-alert-chevron" />
  </Link>
);

const Home = () => {
  const { user } = useUserContext();
  const cfg = useConfig();
  const { alertGroups, puedeVerCompromisos, puedeVerObligaciones } = useHomeAlerts();

  const [areaFilter, setAreaFilter] = useState(() => {
    try { return localStorage.getItem(AREA_FILTER_KEY) || 'all'; } catch { return 'all'; }
  });

  const handleFilter = useCallback((key) => {
    setAreaFilter(key);
    try { localStorage.setItem(AREA_FILTER_KEY, key); } catch { /* noop */ }
  }, []);

  /* Aplanar todas las alertas con la metadata de su categoría. */
  const allAlerts = useMemo(
    () => alertGroups.flatMap((g) =>
      g.items.map((it) => ({
        ...it,
        categoryKey: g.key,
        category: g.label,
        categoryIcon: g.icon,
      })),
    ),
    [alertGroups],
  );

  /* Si el filtro guardado apunta a un área que ya no tiene alertas, volver a "Todas". */
  const effectiveFilter = useMemo(() => {
    if (areaFilter === 'all') return 'all';
    return alertGroups.some((g) => g.key === areaFilter) ? areaFilter : 'all';
  }, [areaFilter, alertGroups]);

  const visibleAlerts = useMemo(
    () => (effectiveFilter === 'all'
      ? allAlerts
      : allAlerts.filter((a) => a.categoryKey === effectiveFilter)),
    [allAlerts, effectiveFilter],
  );

  const criticas = visibleAlerts.filter((a) => a.severity === 'danger');
  const porAtender = visibleAlerts.filter((a) => a.severity !== 'danger');

  const totalCriticas = allAlerts.filter((a) => a.severity === 'danger').length;
  const totalPorAtender = allAlerts.length - totalCriticas;
  const sinAlertas = allAlerts.length === 0;
  const filtrando = effectiveFilter !== 'all';

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="home-container pt-4">
        {/* Header de bienvenida + pulso del sistema */}
        <div className="home-header">
          <div className="home-welcome">
            <div className="home-welcome-text">
              <h1 className="home-title">
                Hola, <span className="home-name">{user.name.split(' ')[0]}</span>
              </h1>
              <p className="home-subtitle">
                {sinAlertas ? (
                  'No tenés tareas ni alertas pendientes. Todo en orden.'
                ) : (
                  <>
                    Tenés{' '}
                    <span className="pulse-danger">
                      {totalCriticas} {totalCriticas === 1 ? 'alerta crítica' : 'alertas críticas'}
                    </span>
                    {' y '}
                    <span className="pulse-warning">{totalPorAtender}</span>
                    {' '}por atender
                  </>
                )}
              </p>
            </div>
            <div className="home-welcome-decoration">
              <span className="home-welcome-date">{fechaLarga()}</span>
            </div>
          </div>
        </div>

        {/* Cards de compromisos y obligaciones por vencer (lado a lado) */}
        {(puedeVerCompromisos || puedeVerObligaciones) && (
          <div className="home-cards-row">
            {puedeVerCompromisos && <HomeCompromisosCard />}
            {puedeVerObligaciones && <HomeObligacionesCard />}
          </div>
        )}

        {/* Sección de alertas */}
        <div className="home-alerts-section">
          {sinAlertas ? (
            <div className="home-alerts-empty">
              <div className="home-alerts-empty-icon">
                <i className="fa-solid fa-circle-check" />
              </div>
              <h3 className="home-alerts-empty-title">¡Todo en orden!</h3>
              <p className="home-alerts-empty-text">
                No hay alertas ni tareas pendientes en este momento. Buen trabajo.
              </p>
              <div className="home-alerts-empty-stats">
                <div className="home-alerts-empty-stat">
                  <i className="fa-solid fa-shield-check" />
                  <span>Sistema al día</span>
                </div>
                <div className="home-alerts-empty-stat">
                  <i className="fa-solid fa-clock-rotate-left" />
                  <span>Actualizado hace instantes</span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="section-header">
                <h2 className="section-title">
                  <i className="fa-solid fa-bell" />
                  Tareas y alertas
                </h2>
              </div>

              {/* Chips de filtro por área */}
              <div className="home-filter-chips">
                <button
                  type="button"
                  className={`home-chip ${effectiveFilter === 'all' ? 'home-chip--active' : ''}`}
                  onClick={() => handleFilter('all')}
                >
                  Todas
                  <span className="home-chip-count">{allAlerts.length}</span>
                </button>
                {alertGroups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    className={`home-chip ${effectiveFilter === g.key ? 'home-chip--active' : ''}`}
                    onClick={() => handleFilter(g.key)}
                  >
                    <i className={g.icon} />
                    {g.label}
                    <span className="home-chip-count">{g.items.length}</span>
                  </button>
                ))}
              </div>

              <div className="home-prio-section">
                {/* Críticas — siempre visible, sin clicks */}
                <div className="home-prio-block home-prio-block--danger">
                  <div className="home-prio-header home-prio-header--danger">
                    <i className="fa-solid fa-triangle-exclamation" />
                    <span>Requiere atención ahora</span>
                    <span className="home-prio-count home-prio-count--danger">
                      {criticas.length}
                    </span>
                  </div>
                  {criticas.length === 0 ? (
                    <div className="home-prio-empty">
                      <i className="fa-solid fa-circle-check" />
                      <span>Sin urgencias{filtrando ? ' en esta área' : ''}</span>
                    </div>
                  ) : (
                    criticas.map((item, i) => (
                      <AlertRow key={i} item={item} showCategoria={!filtrando} />
                    ))
                  )}
                </div>

                {/* Por atender — warnings */}
                <div className="home-prio-block">
                  <div className="home-prio-header home-prio-header--warning">
                    <i className="fa-solid fa-clock" />
                    <span>Por atender</span>
                    <span className="home-prio-count home-prio-count--warning">
                      {porAtender.length}
                    </span>
                  </div>
                  {porAtender.length === 0 ? (
                    <div className="home-prio-empty">
                      <i className="fa-solid fa-circle-check" />
                      <span>Nada pendiente{filtrando ? ' en esta área' : ''}</span>
                    </div>
                  ) : (
                    porAtender.map((item, i) => (
                      <AlertRow key={i} item={item} showCategoria={!filtrando} />
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Tarjeta de soporte */}
        {cfg?.whatsappSoporte && (
          <div className="home-support-section">
            <div className="home-support-card">
              <div className="support-card-decoration" />
              <div className="home-support-icon">
                <i className="fa-solid fa-headset" />
              </div>
              <div className="home-support-body">
                <h4 className="home-support-title">¿Necesitás ayuda?</h4>
                <p className="home-support-desc">
                  Nuestro equipo de soporte está disponible para ayudarte con cualquier consulta o problema
                </p>
              </div>
              <a
                href={`https://wa.me/${cfg.whatsappSoporte}`}
                target="_blank"
                rel="noopener noreferrer"
                className="home-support-btn"
              >
                <i className="fa-brands fa-whatsapp" />
                Contactar soporte
              </a>
            </div>
          </div>
        )}
      </div>
    </Fade>
  );
};

export default Home;
