// src/models/hooks/MuestraHooks.js
module.exports = (Muestra, MuestraHistory) => {
  /**
   * Construye el registro de histórico a partir de la muestra.
   * Los campos contextuales (fecha, idCliente, idObra, idDosificacion) viven
   * en la propia Muestra como snapshot — al crearse desde un Despacho se
   * denormalizan y quedan congelados. Si la muestra fue creada sin despacho,
   * los campos vienen del formulario directamente.
   *
   * Algunos campos auxiliares (hora, remito, idCamion, idEmpleado del despacho)
   * solo existen cuando la muestra está asociada a un despacho; se completan
   * leyendo el despacho asociado si está disponible.
   *
   * @param {Muestra}   muestra    Instancia de Muestra
   * @param {"INSERT"|"UPDATE"|"DELETE"} op  Tipo de operación
   * @param {object}    options    Hook options (contiene transaction y user)
   */
  const buildHistory = async (muestra, op, options) => {
    let despacho = null;
    if (muestra.idDespacho) {
      despacho = await muestra.getDespacho({ transaction: options.transaction });
    }

    await MuestraHistory.create(
      {
        idMuestra:           muestra.idMuestra,
        idTipoProbeta:       muestra.idTipoProbeta,
        cantidadProbetas:    muestra.cantidadProbetas,
        temperaturaAmbiente: muestra.temperaturaAmbiente,
        temperaturaHormigon: muestra.temperaturaHormigon,
        asentamiento:        muestra.asentamiento,
        idOperador:          muestra.idOperador,

        // Campos contextuales — preferir los propios de la Muestra (snapshot).
        fecha:          muestra.fecha          ?? despacho?.fecha          ?? null,
        idCliente:      muestra.idCliente      ?? despacho?.idCliente      ?? null,
        idObra:         muestra.idObra         ?? despacho?.idObra         ?? null,
        idDosificacion: muestra.idDosificacion ?? despacho?.idDosificacion ?? null,

        // remito: prioridad al de la propia muestra (snapshot/edición directa);
        // fallback al del despacho cuando viene de allí.
        remito:     muestra.remito ?? despacho?.remito ?? null,

        // Campos exclusivos del despacho (solo si existe asociación).
        hora:       despacho?.hora ?? null,
        idCamion:
          despacho?.idCamionMixer ??
          despacho?.idTractor     ?? null,
        idEmpleado: despacho?.idEmpleado ?? null,

        operation_type: op,
        operation_date: new Date(),
        operation_user: options.user || "desconocido",
      },
      { transaction: options.transaction }
    );
  };

  Muestra.afterCreate((m, opt) => buildHistory(m, "INSERT", opt));
  Muestra.beforeUpdate((m, opt) => buildHistory(m, "UPDATE", opt));
  Muestra.beforeDestroy((m, opt) => buildHistory(m, "DELETE", opt));
};
