import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import { useToast } from "../../../../context/ToastContext";
import axios from "axios";
import { config } from "../../../../config/config";
import { Fade } from "react-awesome-reveal";
import PlantasMaterialSection from "../../../common/PlantasMaterialSection";
import FormField from "../../../common/FormField";

const FibraForm = ({ setDialogVisible, editFibra, reload, setReload }) => {
    const { id } = useParams() || {};
    const isEditing = Boolean(id || editFibra);

    /* ─────────────  States  ───────────── */
    const [marca, setMarca] = useState("");
    const [fabrica, setFabrica] = useState("");
    const [funcion, setFuncion] = useState("");
    const [tipo, setTipo] = useState("OTRO");
    const [densidad, setDensidad] = useState(null);
    const [idUnidadMedida, setIdUnidadMedida] = useState(null);

    const [listaUnidades, setListaUnidades] = useState([]);
    const [plantasConfig, setPlantasConfig] = useState([]);

    const [saveLoading, setSaveLoading] = useState(false);
    const savingRef = useRef(false);
    const [errorMessage, setErrorMessage] = useState("");

    const showToast = useToast();

    /* ─────────────  Cargar catálogo de unidades  ───────────── */
    useEffect(() => {
        const fetchUnidades = async () => {
            try {
                const res = await axios.get(`${config.backendUrl}/api/aditivos/unidadesmedida`, {
                    headers: config.headers,
                });
                const opts = (res.data || []).map((u) => ({
                    label: `${u.unidad} (${u.descripcion})`,
                    value: u.idUnidadMedida,
                }));
                setListaUnidades(opts);
            } catch (err) {
                console.error(err);
                showToast("error", "No se pudieron cargar las unidades de medida");
            }
        };
        fetchUnidades();
    }, []);

    /* ─────────────  Si editamos  ───────────── */
    useEffect(() => {
        if (editFibra) {
            loadData(editFibra);
        } else if (id) {
            axios
                .get(`${config.backendUrl}/api/fibras/${id}`, { headers: config.headers })
                .then((res) => loadData(res.data))
                .catch((err) => {
                    console.error(err);
                    showToast("error", "No se pudieron cargar los datos de la fibra");
                });
        }
    }, [editFibra, id]);

    const loadData = (a) => {
        setMarca(a.marca || "");
        setFabrica(a.fabrica || "");
        setFuncion(a.funcion || "");
        setTipo(a.tipo || "OTRO");
        setDensidad(a.densidad != null ? Number(a.densidad) : null);
        setIdUnidadMedida(a.idUnidadMedida || null);
        const plantas = Array.isArray(a.plantas) ? a.plantas : [];
        setPlantasConfig(plantas.map(p => ({
            idPlanta: p.idPlanta,
            nombrePlanta: p.planta?.nombre || `Planta ${p.idPlanta}`,
            activo: p.activo !== false,
            observaciones: p.observaciones || null,
            precioActual: p.precioVigente?.precioUnitario != null ? Number(p.precioVigente.precioUnitario) : null,
            unidadPrecio: p.precioVigente?.unidad || 'kg',
            nuevoPrecio: null,
        })));
    };

    /* ─────────────  Validación  ───────────── */
    const validar = () => {
        if (!marca.trim()) return "La marca es obligatoria.";
        if (!fabrica.trim()) return "La fábrica es obligatoria.";
        if (!idUnidadMedida) return "Debes elegir la unidad de medida.";
        return "";
    };

    /* ─────────────  Guardar  ───────────── */
    const guardar = async (e) => {
        e.preventDefault();
        if (savingRef.current) return;
        setErrorMessage("");
        savingRef.current = true;
        setSaveLoading(true);

        const error = validar();
        if (error) {
            setErrorMessage(error);
            savingRef.current = false;
            setSaveLoading(false);
            return;
        }

        const payload = {
            marca,
            fabrica,
            funcion,
            tipo,
            densidad,
            idUnidadMedida,
            plantasConfig: plantasConfig.map(p => ({
                idPlanta: p.idPlanta,
                activo: p.activo !== false,
                observaciones: p.observaciones || null,
            })),
        };

        try {
            let fibraIdGuardada = id || editFibra?.idFibra;
            if (isEditing) {
                await axios.put(`${config.backendUrl}/api/fibras/${fibraIdGuardada}`, payload, { headers: config.headers });
                showToast("success", "Fibra actualizada con éxito");
            } else {
                const r = await axios.post(`${config.backendUrl}/api/fibras`, payload, { headers: config.headers });
                fibraIdGuardada = r.data?.idFibra || r.data?.id;
                showToast("success", "Fibra creada con éxito");
            }

            const hoy = new Date().toISOString().slice(0, 10);
            for (const p of plantasConfig) {
                if (p.nuevoPrecio != null && Number(p.nuevoPrecio) > 0) {
                    try {
                        await axios.post(`${config.backendUrl}/api/material-precios`, {
                            materialSource: 'fibra',
                            materialSourceId: fibraIdGuardada,
                            idPlanta: p.idPlanta,
                            precioUnitario: Number(p.nuevoPrecio),
                            unidad: p.unidadPrecio || 'kg',
                            fechaVigencia: hoy,
                            autoVencer: true,
                        }, { headers: config.headers });
                    } catch (errP) { console.warn('precio', errP.message); }
                }
            }

            if (setReload) setReload(true);
            if (setDialogVisible) setDialogVisible(false);
            else window.history.back();
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.error || "Error al guardar la fibra";
            showToast("error", msg);
        } finally {
            savingRef.current = false;
            setSaveLoading(false);
        }
    };

    /* ─────────────  JSX  ───────────── */
    return (
        <Fade direction="up" duration={500} triggerOnce>
            <div className="flex w-full justify-content-center">
                <div className="p-0 py-4 xl:p-3 xl:pt-5 flex flex-column align-items-center w-full xl:w-9">
                    {/* header */}
                    <div className="form-card-header w-full flex justify-content-between align-items-center">
                        <div>
                            <i className="fa-solid fa-lines-leaning mr-2"></i>
                            {isEditing ? "Editar fibra" : "Nueva fibra"}
                        </div>
                        <i
                            className="fa-solid fa-circle-arrow-left cursor-pointer hover-red"
                            style={{ fontSize: "1.2rem" }}
                            onClick={() => window.history.back()}
                        ></i>
                    </div>

                    {/* form */}
                    <form
                        className="w-full flex flex-column align-items-center form-card pt-5 pb-5"
                        onSubmit={guardar}
                    >
                        <div className="w-full">
                            <div className="grid">
                                <FormField className="col-12 md:col-6" label="Marca" required>
                                    <InputText value={marca} onChange={(e) => setMarca(e.target.value)} className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Fábrica" required>
                                    <InputText value={fabrica} onChange={(e) => setFabrica(e.target.value)} className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Tipo de fibra" required>
                                    <Dropdown
                                        value={tipo}
                                        onChange={(e) => setTipo(e.value)}
                                        options={[
                                            { label: "Macrofibra estructural (acero / sintética estructural)", value: "MACRO" },
                                            { label: "Microfibra polimérica (polipropileno, anti-fisura)",      value: "MICRO" },
                                            { label: "Otro / sin clasificar",                                    value: "OTRO" },
                                        ]}
                                        placeholder="Seleccionar tipo"
                                        className="w-full"
                                    />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Función / Descripción corta">
                                    <InputText value={funcion} onChange={(e) => setFuncion(e.target.value)} className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Unidad de Medida" required>
                                    <Dropdown
                                        value={idUnidadMedida}
                                        onChange={(e) => setIdUnidadMedida(e.value)}
                                        options={listaUnidades}
                                        placeholder="Seleccionar unidad"
                                        className="w-full"
                                    />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Densidad real (kg/m³) — p. ej. acero 7850, sintética/PP ~910">
                                    <InputNumber
                                        value={densidad}
                                        onValueChange={(e) => setDensidad(e.value)}
                                        min={100} max={9000}
                                        minFractionDigits={0} maxFractionDigits={1}
                                        className="w-full"
                                        placeholder="Necesaria para el balance volumétrico del hormigón"
                                    />
                                </FormField>
                            </div>
                        </div>

                        <div className="w-full mt-3">
                            <PlantasMaterialSection
                                value={plantasConfig}
                                onChange={setPlantasConfig}
                                tituloMaterial="esta fibra"
                            />
                        </div>

                        {errorMessage && (
                            <small className="error-msg flex align-items-center mt-2 mb-2">
                                <i className="fa-regular fa-circle-xmark mr-2"></i>
                                {errorMessage}
                            </small>
                        )}

                        <div className="flex justify-content-center mt-3 w-full">
                            <Button
                                label="Guardar"
                                type="submit"
                                rounded
                                loading={saveLoading}
                                disabled={saveLoading}
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

export default FibraForm;
