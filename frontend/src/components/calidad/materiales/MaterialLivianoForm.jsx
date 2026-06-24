import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Fade } from "react-awesome-reveal";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputTextarea } from "primereact/inputtextarea";
import { Button } from "primereact/button";
import { useToast } from "../../../context/ToastContext";
import DetailPageHeader from "../../../common/components/DetailPageHeader/DetailPageHeader";
import FormField from "../../common/FormField";
import {
    obtenerMaterialLiviano,
    crearMaterialLiviano,
    actualizarMaterialLiviano,
} from "../../../services/materialLivianoService";

/**
 * MaterialLivianoForm — Crear/editar materiales livianos manufacturados
 * (telgopor / EPS / perlita / arcilla expandida) usados como sustituto
 * volumétrico del agregado grueso en hormigón alivianado.
 *
 * Sesión 2026-05-29 — viven en `Material` con `MaterialTipo = 'Liviano'`.
 * El catálogo unificado (`MaterialList`) los muestra como tab "Liviano".
 * El "+ Nuevo material" del tab navega acá vía el map `NUEVO_ROUTES`.
 *
 * Form mínimo: nombre, proveedor, densidad declarada (kg/m³), descripción,
 * observaciones. Sin cantera, tipo de roca, ensayos pétreos — esos no
 * aplican al ser manufacturados (fuera de CIRSOC 200 / IRAM 1531/1627).
 */
const MaterialLivianoForm = () => {
    const { id } = useParams();
    const isEditing = Boolean(id);
    const navigate = useNavigate();
    const showToast = useToast();

    const [nombre, setNombre] = useState("");
    const [proveedor, setProveedor] = useState("");
    const [densidad, setDensidad] = useState(null);
    const [origen, setOrigen] = useState("");
    const [observaciones, setObservaciones] = useState("");
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [errorMessage, setErrorMessage] = useState("");

    const fetchMaterial = useCallback(async () => {
        if (!id) return;
        try {
            const m = await obtenerMaterialLiviano(id);
            if (!m) {
                showToast("error", "Material liviano no encontrado");
                navigate("/calidad/catalogos/materiales");
                return;
            }
            setNombre(m.nombre || "");
            setProveedor(m.proveedor || "");
            setDensidad(m.densidad != null ? Number(m.densidad) : null);
            setOrigen(m.origen || "");
            setObservaciones(m.observaciones || "");
        } catch (err) {
            console.error("[MaterialLivianoForm] fetch:", err);
            showToast("error", "No se pudo cargar el material liviano");
        }
    }, [id, navigate, showToast]);

    useEffect(() => { fetchMaterial(); }, [fetchMaterial]);

    const validar = () => {
        if (!nombre.trim()) return "El nombre es obligatorio.";
        if (densidad == null || Number(densidad) <= 0) return "La densidad declarada (kg/m³) es obligatoria. Típico telgopor: 14.";
        return "";
    };

    const guardar = async (e) => {
        e.preventDefault();
        if (savingRef.current) return;
        setErrorMessage("");
        const err = validar();
        if (err) { setErrorMessage(err); return; }
        savingRef.current = true;
        setSaving(true);
        try {
            const payload = {
                nombre: nombre.trim(),
                proveedor: proveedor.trim() || null,
                densidad: Number(densidad),
                origen: origen.trim() || null,
                observaciones: observaciones.trim() || null,
            };
            if (isEditing) {
                await actualizarMaterialLiviano(id, payload);
                showToast("success", "Material actualizado");
            } else {
                await crearMaterialLiviano(payload);
                showToast("success", "Material creado");
            }
            navigate("/calidad/catalogos/materiales");
        } catch (err) {
            const msg = err.response?.data?.error || "Error al guardar el material liviano";
            showToast("error", msg);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return (
        <Fade direction="up" duration={300} triggerOnce className="w-full">
            <div className="flex w-full justify-content-center">
                <div className="p-0 py-4 xl:p-3 xl:pt-5 flex flex-column justify-self-center align-items-center w-full xl:w-9">
                    <DetailPageHeader
                        icon="fa-solid fa-circle-nodes"
                        title={isEditing ? "Editar material liviano" : "Nuevo material liviano"}
                        onBack={() => navigate("/calidad/catalogos/materiales")}
                    />

                    <div className="surface-100 border-round p-3 w-full mt-3 flex align-items-start gap-2">
                        <i className="fa-solid fa-info-circle text-primary mt-1" />
                        <small className="text-color-secondary">
                            Material liviano manufacturado (telgopor / EPS / perlita / arcilla
                            expandida). Fuera de CIRSOC 200 — no se aplican validaciones IRAM
                            1531/1627 ni se requieren ensayos pétreos. Sólo necesita la
                            <strong> densidad declarada por el fabricante</strong> (kg/m³).
                            Carga MANUAL en planta (no automatizada en Betonmatic).
                        </small>
                    </div>

                    <form className="w-full flex flex-column align-items-center form-card pt-5 pb-5 gap-2" onSubmit={guardar}>
                        <div className="w-full">
                            <div className="grid">
                                <FormField className="col-12 md:col-6" label="Nombre" required>
                                    <InputText
                                        value={nombre}
                                        onChange={(e) => setNombre(e.target.value)}
                                        placeholder="Ej: Telgopor en perlas"
                                        className="w-full"
                                        autoFocus
                                    />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Proveedor / marca">
                                    <InputText
                                        value={proveedor}
                                        onChange={(e) => setProveedor(e.target.value)}
                                        placeholder="Ej: Knauf, BASF, Telcomet"
                                        className="w-full"
                                    />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Densidad declarada (kg/m³)" required>
                                    <InputNumber
                                        value={densidad}
                                        onValueChange={(e) => setDensidad(e.value)}
                                        min={5}
                                        max={1500}
                                        step={1}
                                        suffix=" kg/m³"
                                        placeholder="Ej: 14"
                                        className="w-full"
                                    />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Tipo / descripción">
                                    <InputText
                                        value={origen}
                                        onChange={(e) => setOrigen(e.target.value)}
                                        placeholder="Ej: poliestireno expandido (EPS), perlas 2-6 mm"
                                        className="w-full"
                                    />
                                </FormField>
                                <FormField className="col-12" label="Observaciones">
                                    <InputTextarea
                                        value={observaciones}
                                        onChange={(e) => setObservaciones(e.target.value)}
                                        rows={2}
                                        className="w-full"
                                        placeholder="Notas internas, condiciones de almacenaje, etc."
                                    />
                                </FormField>
                            </div>
                        </div>

                        {errorMessage && (
                            <small className="error-msg flex align-items-center mt-2 mb-2">
                                <i className="fa-regular fa-circle-xmark mr-2"></i>
                                {errorMessage}
                            </small>
                        )}

                        <div className="flex justify-content-end mt-3">
                            <Button
                                label="Guardar"
                                type="submit"
                                rounded
                                loading={saving}
                                disabled={saving}
                                icon="fa-solid fa-check"
                                size="small"
                            />
                        </div>
                    </form>
                </div>
            </div>
        </Fade>
    );
};

export default MaterialLivianoForm;
