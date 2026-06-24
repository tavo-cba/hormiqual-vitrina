import React, { useState, useEffect } from "react";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import { Divider } from "primereact/divider";
import { Message } from "primereact/message";
import axios from "axios";
import { config } from "../../config/config";

/**
 * Sección reutilizable: disponibilidad + precios por planta para aditivo/adición/fibra/agregado.
 *
 * Props:
 *  - value: array de filas [{ idPlanta, nombrePlanta, activo, precioActual?, unidadPrecio?, nuevoPrecio?, observaciones? }]
 *  - onChange: (rows) => void
 *  - tituloMaterial: string (ej: "este aditivo")
 *  - hidePrecio: bool (default false). Si true, oculta los campos de precio
 *    (caso agregado: la disponibilidad por planta se gestiona acá pero los
 *    precios viven en otro flujo).
 *
 * El padre es responsable de POSTear los precios nuevos tras guardar el material
 * usando la propiedad row.nuevoPrecio cuando no es null.
 */
const PlantasMaterialSection = ({ value, onChange, tituloMaterial = "este material", hidePrecio = false }) => {
    const [plantasDisponibles, setPlantasDisponibles] = useState([]);

    useEffect(() => {
        axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers })
            .then(res => setPlantasDisponibles(res.data || []))
            .catch(() => setPlantasDisponibles([]));
    }, []);

    const rows = Array.isArray(value) ? value : [];

    const updateRow = (idPlanta, patch) => {
        onChange(rows.map(r => r.idPlanta === idPlanta ? { ...r, ...patch } : r));
    };

    const agregarPlanta = (idPlanta) => {
        if (rows.some(r => r.idPlanta === idPlanta && r.activo)) return;
        const planta = plantasDisponibles.find(p => p.idPlanta === idPlanta);
        if (!planta) return;
        const existing = rows.find(r => r.idPlanta === idPlanta);
        if (existing) {
            updateRow(idPlanta, { activo: true });
            return;
        }
        onChange([...rows, {
            idPlanta,
            nombrePlanta: planta.nombre,
            activo: true,
            precioActual: null,
            unidadPrecio: 'kg',
            nuevoPrecio: null,
            observaciones: null,
        }]);
    };

    const desasignar = (idPlanta) => updateRow(idPlanta, { activo: false });

    const asignadas = rows.filter(r => r.activo);
    const noAsignadas = plantasDisponibles.filter(p => !asignadas.some(r => r.idPlanta === p.idPlanta));

    return (
        <div>
            <h4 className="mt-0 mb-2"><i className="fa-solid fa-industry mr-2 text-primary" />Disponibilidad y precios por planta</h4>
            <p className="text-sm text-color-secondary mt-0 mb-3">
                Indicá en qué plantas está disponible {tituloMaterial} y, si lo conocés, su precio en cada una.
                El precio puede variar entre plantas por costos de transporte.
            </p>

            {asignadas.length === 0 && (
                <Message severity="warn" text={`Sin plantas asignadas: ${tituloMaterial} no aparecerá en los catálogos por planta.`} className="mb-3 w-full" />
            )}

            {asignadas.map(r => (
                <div key={r.idPlanta} className="surface-card border-1 surface-border border-round p-3 mb-3">
                    <div className="flex justify-content-between align-items-center mb-2">
                        <div className="font-bold">
                            <i className="fa-solid fa-location-dot mr-2 text-primary" />
                            {r.nombrePlanta}
                        </div>
                        <Button type="button" label="Quitar" severity="danger" text size="small"
                            icon="fa-solid fa-xmark" onClick={() => desasignar(r.idPlanta)} />
                    </div>
                    {!hidePrecio && (
                        <div className="grid">
                            <div className="col-12 md:col-4 flex flex-column mb-2">
                                <small>Precio actual ({r.unidadPrecio || 'kg'})</small>
                                <InputText
                                    value={r.precioActual != null ? `$ ${Number(r.precioActual).toLocaleString('es-AR')}` : '— sin precio cargado —'}
                                    disabled className="w-full" />
                            </div>
                            <div className="col-12 md:col-4 flex flex-column mb-2">
                                <small>Nuevo precio (opcional)</small>
                                <InputNumber value={r.nuevoPrecio}
                                    onValueChange={(e) => updateRow(r.idPlanta, { nuevoPrecio: e.value })}
                                    mode="currency" currency="ARS" locale="es-AR"
                                    placeholder="Ingresar para actualizar"
                                    className="w-full" />
                            </div>
                            <div className="col-12 md:col-4 flex flex-column mb-2">
                                <small>Unidad</small>
                                <Dropdown value={r.unidadPrecio}
                                    onChange={(e) => updateRow(r.idPlanta, { unidadPrecio: e.value })}
                                    options={[
                                        { label: 'Kilogramo', value: 'kg' },
                                        { label: 'Litro', value: 'l' },
                                        { label: 'Tonelada', value: 'ton' },
                                        { label: 'Bolsa', value: 'bolsa' },
                                    ]}
                                    className="w-full" />
                            </div>
                        </div>
                    )}
                </div>
            ))}

            {noAsignadas.length > 0 && (
                <Dropdown value={null}
                    onChange={(e) => agregarPlanta(e.value)}
                    options={noAsignadas.map(p => ({ label: p.nombre, value: p.idPlanta }))}
                    placeholder="Asignar nueva planta..."
                    className="w-full mb-2" />
            )}

            <Divider />
        </div>
    );
};

export default PlantasMaterialSection;
