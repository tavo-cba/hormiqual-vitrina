import React, { createContext, useState, useEffect } from 'react';

export const ThemeContext = createContext();

const SwitchThemeProvider = ({ children }) => {
  // Se inicia leyendo del localStorage; si no existe, se usa 'dark'
  const [isDark, setIsDark] = useState(() => {
    const storedTheme = localStorage.getItem('theme');
    const initialIsDark = storedTheme ? storedTheme === 'dark' : true;
    document.documentElement.setAttribute('data-theme', initialIsDark ? 'dark' : 'light');
    return initialIsDark;
  });

  // Cada vez que el tema cambia, se actualiza localStorage y el CSS
  useEffect(() => {
    const theme = isDark ? 'dark' : 'light';
    localStorage.setItem('theme', theme);

    // Cambia el atributo data-theme en el elemento raíz para que las variables de CSS se actualicen
    document.documentElement.setAttribute('data-theme', theme);

    // Actualiza el meta theme-color para que la barra de estado de la PWA respete el tema
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', isDark ? '#24242b' : '#ffffff');
    }

    // Actualiza el tema de PrimeReact
    const themeLinkId = 'prime-theme';
    const link = document.getElementById(themeLinkId) || document.createElement('link');
    link.id = themeLinkId;
    link.rel = 'stylesheet';
    link.href = `https://unpkg.com/primereact/resources/themes/bootstrap4-${theme}-blue/theme.css`;
    if (!link.parentElement) {
      document.head.appendChild(link);
    }
  }, [isDark]);

  const toggleTheme = () => {
    setIsDark(prev => !prev);
  };

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
export default SwitchThemeProvider;