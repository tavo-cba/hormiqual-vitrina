import React from "react";

const DosificacionPanel = ({ dosificacion }) => {
  if (!dosificacion) return null;
  return (
    <div className="p-3 py-0 flex flex-column gap-2">
      <div>
        <b>Nombre:</b> {dosificacion.nombre}
      </div>
      <div>
        <b>Tipo de Hormigón:</b> {dosificacion.tipoHormigon?.tipoHormigon || '—'}
      </div>
      <div>
        <b>Planta:</b> {dosificacion.planta?.nombre || '—'}
      </div>
      <div>
        <b>Agua (L):</b> {dosificacion.agua ?? '—'}
      </div>
      {dosificacion.codigoEnPlanta && (
        <div>
          <b>Código en planta:</b> {dosificacion.codigoEnPlanta}
        </div>
      )}
      {dosificacion.descripcion && (
        <div>
          <b>Descripción:</b> {dosificacion.descripcion}
        </div>
      )}
    </div>
  );
};

export default DosificacionPanel;