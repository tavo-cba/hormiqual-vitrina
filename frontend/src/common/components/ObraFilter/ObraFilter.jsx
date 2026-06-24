import React from "react";
import { SelectButton } from "primereact/selectbutton";
import useObraFilter from "./useObraFilter";
import "./ObraFilter.css";

// Filtro segmentado tri-estado para "empleado de obra vs. administrativo".
// Reemplaza el Dropdown duplicado en recibos, registro horario, liquidacion y
// liquidacion alternativa. Valor: null = todos, true = obra, false = admin.
//
// Persistencia opcional vía localStorage usando el hook useObraFilter.

const OPTIONS = [
    {
        value: null,
        label: "Todos",
        labelShort: "Todos",
        icon: "fa-solid fa-users",
    },
    {
        value: true,
        label: "Obra",
        labelShort: "Obra",
        icon: "fa-solid fa-helmet-safety",
    },
];

const itemTemplate = (opt) => (
    <span className="flex align-items-center gap-2">
        <i className={`obra-filter-icon ${opt.icon}`} aria-hidden="true" />
        <span className="obra-filter-label-long">{opt.label}</span>
        <span className="obra-filter-label-short">{opt.labelShort}</span>
    </span>
);

export default function ObraFilter({ value, onChange, className = "" }) {
    return (
        <SelectButton
            value={value}
            options={OPTIONS}
            optionLabel="label"
            optionValue="value"
            onChange={(e) => {
                // SelectButton emite undefined si el usuario clickea el ya
                // seleccionado con unselectable=true. Lo normalizamos a null
                // (= "Todos") para que siempre haya una opción activa visible.
                if (e.value === undefined) return;
                onChange(e.value);
            }}
            itemTemplate={itemTemplate}
            unselectable={false}
            className={`obra-filter ${className}`}
            aria-label="Filtrar por tipo de empleado"
        />
    );
}

export { useObraFilter };
