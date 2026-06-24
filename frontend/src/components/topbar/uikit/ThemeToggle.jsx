import React, { useContext } from 'react';
import { ThemeContext } from '../../../context/ThemeContext';
import './ThemeToggle.css';

const ThemeToggle = ({ showLabel = true }) => {
  const { isDark, toggleTheme } = useContext(ThemeContext);

  return (
    <button
      className="theme-toggle-btn"
      onClick={toggleTheme}
      aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      title={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
    >
      <div className="theme-toggle-icon-wrapper">
        <i className={`fa-solid ${isDark ? 'fa-sun' : 'fa-moon'} theme-toggle-icon`} />
      </div>
      {showLabel && (
        <span className="theme-toggle-label">
          {isDark ? 'Claro' : 'Oscuro'}
        </span>
      )}
    </button>
  );
};

export default ThemeToggle;
