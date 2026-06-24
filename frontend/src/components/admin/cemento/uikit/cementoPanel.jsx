import React from "react";

const DESARROLLO_LABELS = { RAPIDO: 'Rápido (ARI)', NORMAL: 'Normal', LENTO: 'Lento' };

const CementoPanel = ({ cemento }) => {
    if (!cemento) return null;

    const propiedades = Array.isArray(cemento.propiedades)
        ? cemento.propiedades.join(', ')
        : (cemento.propiedades || '—');

    const densidad = cemento.densidadRelativa ? Number(cemento.densidadRelativa) : null;

    return (
        <div className="p-3 py-0 flex flex-column gap-2">
            <div><b>Nombre comercial:</b> {cemento.nombreComercial}</div>
            <div><b>Fabricante:</b> {cemento.fabricante}</div>
            <div><b>Origen fábrica:</b> {cemento.origenFabrica || '—'}</div>
            <div><b>Tipo normativo:</b> {cemento.tipoNormativo || '—'}</div>
            <div><b>Composición:</b> {cemento.composicion}</div>
            <div><b>Resistencia:</b> {cemento.resistencia}</div>
            <div><b>Familia cemento:</b> {cemento.familiaCemento || '—'}</div>
            <div><b>Propiedades especiales:</b> {propiedades}</div>
            <div><b>Desarrollo resistencia:</b> {DESARROLLO_LABELS[cemento.desarrolloResistencia] || '—'}</div>
            <div>
                <b>Densidad real:</b>{' '}
                {densidad ? `${densidad} g/cm³` : <span className="text-orange-500">No cargada — no apto para dosificación</span>}
            </div>
            <div><b>Edad referencia:</b> {cemento.edadReferenciaDefault || 28} días</div>
            {cemento.observaciones && <div><b>Observaciones:</b> {cemento.observaciones}</div>}

            {/* TODO: Sección de documentación técnica asociada (ensayos, fichas de seguridad, certificados)
               Se habilitará cuando se implemente la asociación de documentos a materiales. */}
        </div>
    );
};

export default CementoPanel;