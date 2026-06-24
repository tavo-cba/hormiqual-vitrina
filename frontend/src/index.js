import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { preloadDejavu } from './lib/format/dejavuFont';

// P2.1 — pre-cargar DejaVu Sans en background. Si el archivo está en
// public/fonts/DejaVuSans.ttf, los PDFs lo usarán automáticamente. Si no,
// fallback transparente a Helvetica + sanitizer Latin-1. No bloquea el render.
preloadDejavu().catch(() => { /* silent fallback */ });

// Preferencias del usuario que afectan el DOM raíz — aplicarlas ANTES del
// primer render para evitar flicker. Configuración → Preferencias guarda
// las prefs en localStorage; acá las leemos al boot. Si el user no eligió
// nada, queda el comportamiento por defecto (sin clase).
(() => {
  try {
    const density = localStorage.getItem('tableDensity');
    if (density && density !== 'normal') {
      document.documentElement.classList.add(`density-${density}`);
    }
  } catch (_) { /* localStorage no disponible (SSR, modo privado, etc.) */ }
})();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
