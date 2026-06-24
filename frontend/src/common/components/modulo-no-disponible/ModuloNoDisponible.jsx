import React from 'react';
import { useConfig } from '../../../context/ConfigContext';

const ModuloNoDisponible = () => {
  const cfg = useConfig();
  const whatsapp = cfg?.whatsappSoporte;

  const whatsappUrl = whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, me interesa habilitar un nuevo módulo en el sistema.')}`
    : null;

  return (
    <div className="w-full h-full flex flex-column align-items-center justify-content-center text-center p-4 gap-3" style={{ minHeight: '60vh' }}>
      <div
        className="flex align-items-center justify-content-center border-circle"
        style={{ width: '80px', height: '80px', background: 'var(--surface-hover)' }}
      >
        <i className="fa-solid fa-puzzle-piece" style={{ fontSize: '2.5rem', color: 'var(--primary-color)' }} />
      </div>

      <h2 className="m-0">Módulo no disponible</h2>

      <p className="text-color-secondary m-0 line-height-3" style={{ maxWidth: '420px' }}>
        Este módulo no está incluido en tu plan actual.
        Contactanos para habilitarlo y acceder a todas sus funcionalidades.
      </p>

      {whatsappUrl && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-button p-component no-underline mt-2"
          style={{
            backgroundColor: '#25D366',
            border: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            color: 'white',
            fontWeight: 'bold',
            fontSize: '1rem',
            textDecoration: 'none',
          }}
        >
          <i className="fa-brands fa-whatsapp" style={{ fontSize: '1.3rem' }} />
          Contactar por WhatsApp
        </a>
      )}
    </div>
  );
};

export default ModuloNoDisponible;
