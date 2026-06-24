import React, { useState, useEffect, useRef } from "react";
import { InputText, InputNumber, Dropdown, Button } from "primereact";
import { Fade } from "react-awesome-reveal";
import { useParams, useNavigate } from "react-router-dom";
import { useToast } from "../../../context/ToastContext";
import axios from "axios";
import { config } from "../../../config/config";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import { listLaboratorios } from "../../../services/laboratorioService";

const PiletaForm = () => {
    const { id } = useParams();
    const editing = !!id;
    const navigate = useNavigate();
    const toast = useToast();

    const [plantas, setPlantas] = useState([]);
    const [laboratorios, setLaboratorios] = useState([]);
    const [nombre, setNombre] = useState("");
    const [hashId, setHashId] = useState("");
    const [idPlanta, setIdPlanta] = useState(null);
    const [idLaboratorio, setIdLaboratorio] = useState(null);
    const [umbralAlerta, setUmbralAlerta] = useState(3);
    const [wattsResistencias, setWattsResistencias] = useState(null);
    const [wattsBombas, setWattsBombas] = useState(null);
    const [precioKwh, setPrecioKwh] = useState(null);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers });
                setPlantas(data.map(p => ({ label: p.nombre, value: p.idPlanta })));
            } catch { }
        })();
        listLaboratorios()
            .then((data) => setLaboratorios((data || []).map(l => ({ label: l.nombre, value: l.idLaboratorio }))))
            .catch(() => setLaboratorios([]));
    }, []);

    useEffect(() => {
        if (!editing) return;
        (async () => {
            setLoading(true);
            try {
                const { data } = await axios.get(`${config.backendUrl}/api/piletas/${id}`, { headers: config.headers });
                setNombre(data.nombre);
                setHashId(data.hashId);
                setIdPlanta(data.idPlanta);
                setIdLaboratorio(data.idLaboratorio || null);
                setUmbralAlerta(Number(data.umbralAlerta));
                setWattsResistencias(data.wattsResistencias != null ? Number(data.wattsResistencias) : null);
                setWattsBombas(data.wattsBombas != null ? Number(data.wattsBombas) : null);
                setPrecioKwh(data.precioKwh != null ? Number(data.precioKwh) : null);
            } catch {
                toast("error", "No se pudo cargar la pileta");
                window.history.back();
            } finally {
                setLoading(false);
            }
        })();
    }, [editing, id]);

    const handleSave = async (e) => {
        e.preventDefault();
        if (savingRef.current) return;
        if (!nombre) return toast("warn", "El nombre es requerido");
        if (!hashId) return toast("warn", "El Hash ID es requerido");

        const payload = { nombre, hashId, idPlanta, idLaboratorio, umbralAlerta, wattsResistencias, wattsBombas, precioKwh };

        try {
            savingRef.current = true;
            setSaving(true);
            if (editing) {
                await axios.put(`${config.backendUrl}/api/piletas/${id}`, payload, { headers: config.headers });
                toast("success", "Pileta actualizada");
            } else {
                await axios.post(`${config.backendUrl}/api/piletas`, payload, { headers: config.headers });
                toast("success", "Pileta creada");
            }
            window.history.back();
        } catch (err) {
            const msg = err.response?.data?.error || "Error al guardar";
            toast("error", msg);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="cover-container w-full h-full flex align-self-center justify-content-center"><LoadSpinner /></div>;
    }

    return (
        <Fade direction="up" duration={500} triggerOnce>
            <div className="w-full flex-column flex justify-content-center align-items-center py-5">
                <div className="form-card-header flex align-items-center justify-content-between w-full xl:w-6">
                    <h3 className="m-0">
                        <i className="fa-solid fa-water mr-2" />
                        {editing ? "Editar pileta" : "Nueva pileta"}
                    </h3>
                    <i className="fa-solid fa-circle-arrow-left cursor-pointer hover-red"
                        style={{ fontSize: "1.2rem" }} onClick={() => window.history.back()}></i>
                </div>

                <form className="form-card p-4 w-full xl:w-6">
                    <div className="flex w-full flex-wrap">
                        <div className="flex flex-column col-12 md:col-6">
                            <label>Nombre <span className="text-red-500">*</span></label>
                            <InputText value={nombre} onChange={e => setNombre(e.target.value)} className="w-full" placeholder="Ej: Pileta 1" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <label>Hash ID <span className="text-red-500">*</span></label>
                            <InputText value={hashId} onChange={e => setHashId(e.target.value)}
                                className="w-full" disabled={editing} placeholder="UUID del laboratorio" />
                            {!editing && <small className="text-500">Copiá el Hash ID desde la configuración del Laboratorio</small>}
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <label>Planta</label>
                            <Dropdown value={idPlanta} onChange={e => setIdPlanta(e.value)}
                                options={plantas} filter showClear className="w-full" placeholder="Seleccionar planta" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <label>Laboratorio</label>
                            <Dropdown value={idLaboratorio} onChange={e => setIdLaboratorio(e.value)}
                                options={laboratorios} filter showClear className="w-full" placeholder="Sin laboratorio asignado" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <label>Umbral de alerta</label>
                            <InputNumber value={umbralAlerta} onChange={e => setUmbralAlerta(e.value)}
                                min={0.5} max={20} minFractionDigits={1} suffix=" °C" className="w-full" inputClassName="w-full" />
                            <small className="text-500">Diferencia máxima en °C antes de alertar</small>
                        </div>

                        <div className="col-12 mt-2">
                            <span className="font-semibold" style={{ color: 'var(--text-color-secondary)' }}>
                                <i className="fa-solid fa-bolt mr-2" />Consumo eléctrico (opcional)
                            </span>
                        </div>
                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                            <label>Watts — Resistencias</label>
                            <InputNumber value={wattsResistencias} onChange={e => setWattsResistencias(e.value)}
                                min={0} max={99999} minFractionDigits={0} maxFractionDigits={2}
                                suffix=" W" className="w-full" inputClassName="w-full" placeholder="Ej: 3000" />
                        </div>
                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                            <label>Watts — Bombas</label>
                            <InputNumber value={wattsBombas} onChange={e => setWattsBombas(e.value)}
                                min={0} max={99999} minFractionDigits={0} maxFractionDigits={2}
                                suffix=" W" className="w-full" inputClassName="w-full" placeholder="Ej: 750" />
                        </div>
                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                            <label>Precio del kWh</label>
                            <InputNumber value={precioKwh} onChange={e => setPrecioKwh(e.value)}
                                min={0} minFractionDigits={2} maxFractionDigits={4}
                                prefix="$ " className="w-full" inputClassName="w-full" placeholder="Ej: 200.50" />
                            <small className="text-500">Para calcular costo de consumo</small>
                        </div>
                    </div>

                    <div className="flex justify-content-center mt-4">
                        <Button label="Guardar" icon="fa-solid fa-check" size="small" rounded
                            loading={saving} disabled={saving} onClick={handleSave} />
                    </div>
                </form>
            </div>
        </Fade>
    );
};

export default PiletaForm;
