import React from "react";

const FibraPanel = ({ fibra }) => {
    if (!fibra) return null;
    return (
        <div className="w-full xl:px-3 flex flex-wrap">
            <div className="flex flex-column col-6">
                <small>MARCA</small>
                <span className="font-bold">{fibra.marca}</span>
            </div>
            <div className="flex flex-column col-6">
                <small>FÁBRICA</small>
                <span className="font-bold">{fibra.fabrica}</span>
            </div>
            <div className="flex flex-column col-6">
                <small>FUNCIÓN</small>
                <span className="font-bold">{fibra.funcion || '—'}</span>
            </div>
            <div className="flex flex-column col-6">
                <small>UNIDAD DE MEDIDA</small>
                <span className="font-bold">{fibra.unidadMedida?.unidad || '—'}</span>
            </div>
        </div>
    );
};

export default FibraPanel;