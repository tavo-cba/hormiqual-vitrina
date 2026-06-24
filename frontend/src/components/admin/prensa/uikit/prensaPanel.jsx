import React from "react";
import { formatDate } from "../../../../common/functions";
import { getYear } from "date-fns";

const PrensaPanel = ({ prensa }) => {
    if (!prensa) return null;
    return (
        <div className="p-3 py-0 flex flex-column gap-2">
            <div><b>Nombre:</b> {prensa.nombre}</div>
            <div><b>Marca:</b> {prensa.marca || '—'}</div>
            <div><b>Modelo:</b> {prensa.modelo || '—'}</div>
            <div><b>Año:</b> {getYear(prensa.anio) || '—'}</div>
            <div><b>Capacidad:</b> {prensa.capacidad || '—'}</div>
            <div><b>Fecha última calibración:</b> {prensa.fechaUltimaCalibracion ? formatDate(prensa.fechaUltimaCalibracion) : '—'}</div>
            <div><b>Certificado vigente:</b> {prensa.certificadoVigente ? 'Sí' : 'No'}</div>
            <div><b>Descripción:</b> {prensa.descripcion || '—'}</div>
        </div>
    );
};

export default PrensaPanel;