import React from "react";

/**
 * Celda de formulario para grillas PrimeFlex (.grid).
 *
 * Resuelve el desalineado responsive de los forms de Materiales: cuando los
 * labels son largos y wrappean a 2-3 líneas en viewports angostos, los inputs
 * arrancaban a distinta altura dentro de la misma fila. Acá el label reserva
 * una altura consistente y el control se ancla al fondo de la celda
 * (`mt-auto`). Como las celdas de una `.grid` se estiran a la altura de la más
 * alta de su fila, todos los controles de la fila quedan alineados sin importar
 * cuántas líneas ocupe cada label.
 *
 * Usar SÓLO para celdas simples label + control. Si la celda tiene contenido
 * después del control (texto de ayuda, botones), no envolver con FormField:
 * el `mt-auto` empujaría el control contra ese contenido.
 */
const FormField = ({ className = "col-12 sm:col-6 lg:col-4", label, required, children }) => (
    <div className={`${className} flex flex-column mb-2`}>
        <small className="block mb-2" style={{ minHeight: "2.5em", lineHeight: 1.2 }}>
            {required && <small className="color-danger">* </small>}{label}
        </small>
        <div className="mt-auto w-full">{children}</div>
    </div>
);

export default FormField;
