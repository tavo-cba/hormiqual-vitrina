import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { config as appConfig, loadTenantConfig } from '../config/config';

const ConfigContext = createContext(null);

export const ConfigProvider = ({ children }) => {
  const [cfg, setCfg] = useState(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        await loadTenantConfig();
        const { data } = await axios.get(`${appConfig.backendUrl}/api/config`, {
          headers: appConfig.headers,
        });
        setCfg(data);
      } catch (err) {
        console.error('No se pudo cargar la configuración', err);
      }
    };
    fetchConfig();
  }, []);

  useEffect(() => {
    if (!cfg) return;
    document.title = cfg.nombreEmpresa
      ? `${cfg.nombreEmpresa} - Hormiqual`
      : 'Hormiqual';

    let favicon = document.querySelector("link[rel='icon']");
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }
    if (cfg.thumbnail) {
      favicon.href = cfg.thumbnail;
    } else if (favicon.parentNode) {
      favicon.parentNode.removeChild(favicon);
    }
  }, [cfg]);

  return (
    <ConfigContext.Provider value={cfg}>{children}</ConfigContext.Provider>
  );
};

export const useConfig = () => useContext(ConfigContext);