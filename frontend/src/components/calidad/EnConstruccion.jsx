import React from 'react';
import PageHeader from '../../common/components/PageHeader/PageHeader';

/**
 * Placeholder genérico para secciones del módulo Calidad aún no implementadas.
 * Recibe opcionalmente `titulo` y `subtitulo` vía props o React Router state.
 */
const EnConstruccion = ({ titulo, subtitulo }) => {
    const t = titulo ?? 'En construcción';
    const s = subtitulo ?? 'Esta sección estará disponible próximamente.';

    return (
        <div className="p-4">
            <PageHeader
                icon="fa-solid fa-helmet-safety"
                title={t}
                subtitle={s}
            />
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '40vh',
                    gap: '1rem',
                    color: '#6b7280',
                }}
            >
                <i className="fa-solid fa-hammer" style={{ fontSize: '4rem', color: '#d1d5db' }} />
                <p style={{ fontSize: '1.1rem' }}>
                    Estamos trabajando en esta funcionalidad.
                </p>
            </div>
        </div>
    );
};

export default EnConstruccion;
