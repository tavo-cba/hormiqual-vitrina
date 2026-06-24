import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { Calendar } from "primereact/calendar";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { InputNumber } from "primereact/inputnumber";
import { useToast } from "../../../../context/ToastContext";
import axios from "axios";
import { config } from "../../../../config/config";
import { Fade, Slide } from "react-awesome-reveal";
import { flushSync } from "react-dom";
import { Dropdown } from "primereact/dropdown";

const PrensaForm = ({ setDialogVisible, editPrensa, reload, setReload }) => {
    const { id } = useParams();    // /prensas/editar/:id
    const navigate = useNavigate();
    const isEditing = Boolean(id || editPrensa);

    const showToast = useToast();

    // Campos de la prensa
    const [nombre, setNombre] = useState("");
    const [marca, setMarca] = useState("");
    const [modelo, setModelo] = useState("");
    const [anio, setAnio] = useState(null); // Date
    const [capacidad, setCapacidad] = useState("");
    const [fechaUltimaCalibracion, setFechaUltimaCalibracion] = useState(null);
    const [certificadoVigente, setCertificadoVigente] = useState(false);
    const [descripcion, setDescripcion] = useState("");
    const [idUnidadMedidaPrensa, setIdUnidadMedidaPrensa] = useState(null);
    const [listaUnidades, setListaUnidades] = useState([]);
    const [coeficienteUno, setCoeficienteUno] = useState(null);
    const [coeficienteDos, setCoeficienteDos] = useState(null);
    const [coeficienteTres, setCoeficienteTres] = useState(null);
    const [idPlanta, setIdPlanta] = useState(null);
    const [listaPlantas, setListaPlantas] = useState([]);

    // Carga/errores
    const [saveLoading, setSaveLoading] = useState(false);
    const savingRef = useRef(false);
    const [errorMessage, setErrorMessage] = useState("");

    // 1. Cargar datos si editamos
    useEffect(() => {
        if (editPrensa) {
            // Datos recibidos por prop
            setNombre(editPrensa.nombre || "");
            setMarca(editPrensa.marca || "");
            setModelo(editPrensa.modelo || "");
            setAnio(editPrensa.anio ? new Date(editPrensa.anio) : null);
            setCapacidad(editPrensa.capacidad || "");
            setIdUnidadMedidaPrensa(editPrensa.idUnidadMedidaPrensa || null);
            setFechaUltimaCalibracion(
                editPrensa.fechaUltimaCalibracion ? new Date(editPrensa.fechaUltimaCalibracion) : null
            );
            setCertificadoVigente(!!editPrensa.certificadoVigente);
            setDescripcion(editPrensa.descripcion || "");
            setCoeficienteUno(editPrensa.coeficienteUno ?? null);
            setCoeficienteDos(editPrensa.coeficienteDos ?? null);
            setCoeficienteTres(editPrensa.coeficienteTres ?? null);
            setIdPlanta(editPrensa.idPlanta ?? null);
        } else if (id) {
            // Fetch con id
            axios
                .get(`${config.backendUrl}/api/prensas/${id}`, { headers: config.headers })
                .then((res) => {
                    const p = res.data;
                    setNombre(p.nombre || "");
                    setMarca(p.marca || "");
                    setModelo(p.modelo || "");
                    setAnio(p.anio ? new Date(p.anio) : null);
                    setCapacidad(p.capacidad || "");
                    setIdUnidadMedidaPrensa(p.idUnidadMedidaPrensa || null);
                    setFechaUltimaCalibracion(
                        p.fechaUltimaCalibracion ? new Date(p.fechaUltimaCalibracion) : null
                    );
                    setCertificadoVigente(!!p.certificadoVigente);
                    setDescripcion(p.descripcion || "");
                    setCoeficienteUno(p.coeficienteUno ?? null);
                    setCoeficienteDos(p.coeficienteDos ?? null);
                    setCoeficienteTres(p.coeficienteTres ?? null);
                    setIdPlanta(p.idPlanta ?? null);
                })
                .catch((err) => {
                    console.error(err);
                    showToast("error", "No se pudieron cargar los datos de la prensa");
                });
        }
    }, [editPrensa, id]);

    useEffect(() => {
        const fetchCatalogos = async () => {
            try {
                const [resUnidades, resPlantas] = await Promise.all([
                    axios.get(`${config.backendUrl}/api/prensas/unidadesmedida`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers }),
                ]);
                const opts = (resUnidades.data || []).map((u) => ({
                    label: `${u.unidad} (${u.descripcion})`,
                    value: u.idUnidadMedidaPrensa,
                }));
                setListaUnidades(opts);
                setListaPlantas((resPlantas.data || []).map((p) => ({
                    label: p.nombre,
                    value: p.idPlanta,
                })));
            } catch (err) {
                console.error(err);
                showToast("error", "No se pudieron cargar los catálogos");
            }
        };
        fetchCatalogos();
    }, []);

    // Validar
    const validarFormulario = () => {
        if (!nombre.trim()) {
            return "El nombre de la prensa es obligatorio.";
        }
        if (!idUnidadMedidaPrensa) return "Debes elegir la unidad de medida.";
        return "";
    };

    // Guardar prensa (POST o PUT)
    const guardarPrensa = async (e) => {
        e.preventDefault();
        if (savingRef.current) return;
        setErrorMessage("");
        savingRef.current = true;
        setSaveLoading(true);

        const error = validarFormulario();
        if (error) {
            setErrorMessage(error);
            savingRef.current = false;
            setSaveLoading(false);
            return;
        }

        // Armar payload
        const payload = {
            nombre,
            marca,
            modelo,
            anio,
            capacidad,
            idUnidadMedidaPrensa,
            fechaUltimaCalibracion,
            certificadoVigente,
            descripcion,
            coeficienteUno,
            coeficienteDos,
            coeficienteTres,
            idPlanta,
        };

        try {
            if (isEditing && (id || editPrensa?.idPrensa)) {
                // Actualizar
                const prensaId = id || editPrensa.idPrensa;
                await axios.put(`${config.backendUrl}/api/prensas/${prensaId}`, payload, {
                    headers: config.headers,
                });
                showToast("success", "Prensa actualizada con éxito");
            } else {
                // Crear
                await axios.post(`${config.backendUrl}/api/prensas`, payload, {
                    headers: config.headers,
                });
                showToast("success", "Prensa creada con éxito");
            }

            if (setReload) setReload(true);
            if (setDialogVisible) {
                setDialogVisible(false);
            } else {
                navigate("/admin/prensas");
            }
        } catch (error) {
            console.error(error);
            const msg = error.response?.data?.error || "Error al guardar la prensa";
            showToast("error", msg);
        } finally {
            savingRef.current = false;
            setSaveLoading(false);
        }
    };

    return (
        <Fade direction="up" duration={500} triggerOnce className="w-full">
            <div className="flex w-full justify-content-center">
                <div className="p-0 py-4 xl:p-3 xl:pt-5  flex flex-column justify-self-center align-items-center w-full xl:w-8">
                    <div className="form-card-header w-full align-self-start align-items-center justify-content-between mt-0 text-center flex">
                        <div>
                            <i className="fa-solid fa-cube mr-2"></i>
                            <span>{isEditing ? "Editar prensa" : "Nueva prensa"}</span>
                        </div>
                        <i
                            className="fa-solid fa-circle-arrow-left cursor-pointer hover-red"
                            style={{ fontSize: "1.2rem" }}
                            onClick={() => navigate("/admin/prensas")}
                        ></i>
                    </div>

                    <div className="flex flex-column justify-content-between align-items-center w-full">
                        <form
                            className="w-full flex flex-column align-items-center "
                            onSubmit={guardarPrensa}
                        >
                            <div direction="up" duration={500} triggerOnce className="w-full justify-content-center flex form-card pt-5 pb-5">
                                <div className="flex flex-column gap-3 w-full xl:w-auto">
                                    <div className="flex flex-wrap gap-2 xl:gap-0 justify-content-between">
                                        {/* Nombre */}
                                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                            <small className="mb-1">
                                                <small className="color-danger">* </small>
                                                Nombre
                                            </small>
                                            <InputText
                                                id="nombrePrensa"
                                                value={nombre}
                                                onChange={(e) => setNombre(e.target.value)}
                                                required
                                            />
                                        </div>
                                        {/* Marca, Modelo */}
                                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                            <small className="mb-1">Marca</small>
                                            <InputText
                                                id="marca"
                                                value={marca}
                                                onChange={(e) => setMarca(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                            <small className="mb-1">Modelo</small>
                                            <InputText
                                                id="modelo"
                                                value={modelo}
                                                onChange={(e) => setModelo(e.target.value)}
                                            />
                                        </div>
                                        {/* Año, capacidad */}
                                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                            <small className="mb-1">Año</small>
                                            <Calendar
                                                id="anio"
                                                value={anio}
                                                onChange={(e) => setAnio(e.value)}

                                                dateFormat="yy"
                                                view="year"
                                                placeholder="Seleccionar año"
                                            />
                                        </div>
                                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                            <small className="mb-1">Capacidad</small>
                                            <InputText
                                                id="capacidad"
                                                value={capacidad}
                                                onChange={(e) => setCapacidad(e.target.value)}
                                                placeholder="Ej: 100Tn"
                                            />
                                        </div>
                                        {/* Fecha ultima calibracion */}
                                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                            <small className="mb-1">Fecha última calibración</small>
                                            <Calendar
                                                id="fechaUltimaCalibracion"
                                                value={fechaUltimaCalibracion}
                                                onChange={(e) => setFechaUltimaCalibracion(e.value)}

                                                dateFormat="dd/mm/yy"
                                                placeholder="Ej: 15/08/2023"
                                                showOnFocus={false}
                                                showIcon
                                            />
                                        </div>
                                        {/* Certificado vigente */}
                                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                            <small className="mb-1">Certificado vigente</small>
                                            <div className="flex align-items-center gap-2">
                                                <Checkbox
                                                    inputId="certificadoVigente"
                                                    checked={certificadoVigente}
                                                    onChange={(e) => setCertificadoVigente(e.checked)}
                                                />
                                                <label htmlFor="certificadoVigente" className="mt-1">
                                                    ¿Está vigente?
                                                </label>
                                            </div>
                                        </div>
                                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                            <small>
                                                <small className="color-danger">* </small>Unidad de Medida
                                            </small>
                                            <Dropdown
                                                value={idUnidadMedidaPrensa}
                                                onChange={(e) => setIdUnidadMedidaPrensa(e.value)}
                                                options={listaUnidades}
                                                placeholder="Seleccionar unidad"
                                            />
                                        </div>
                                        {/* Descripción */}
                                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                            <small className="mb-1">Descripción</small>
                                            <InputText
                                                id="descripcion"
                                                value={descripcion}
                                                onChange={(e) => setDescripcion(e.target.value)}
                                                placeholder="Comentarios o detalles de la prensa"
                                            />
                                        </div>
                                        {/* Planta asociada */}
                                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                            <small className="mb-1">Planta asociada</small>
                                            <Dropdown
                                                value={idPlanta}
                                                onChange={(e) => setIdPlanta(e.value)}
                                                options={listaPlantas}
                                                placeholder="Sin planta asignada"
                                                showClear
                                                filter
                                            />
                                        </div>
                                        <div className="flex flex-column mt-3 w-full gap-3 p-3 surface-border surface-card br-15">
                                            <h4 className="m-0">Ecuacion correlación entre divisiones y cargas reales</h4>
                                            <div className="flex flex-column xl:flex-row justify-content-between">
                                                <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                                    <small>Coeficiente 1</small>
                                                    <InputNumber
                                                        value={coeficienteUno}
                                                        onChange={(e) => setCoeficienteUno(e.value)}
                                                        mode="decimal"
                                                        minFractionDigits={6}
                                                        className="w-full"
                                                        inputClassName="w-full"
                                                    />
                                                </div>
                                                <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                                    <small>Coeficiente 2</small>
                                                    <InputNumber
                                                        value={coeficienteDos}
                                                        onChange={(e) => setCoeficienteDos(e.value)}
                                                        mode="decimal"
                                                        minFractionDigits={6}
                                                        className="w-full"
                                                        inputClassName="w-full"
                                                    />
                                                </div>
                                                <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                                                    <small>Coeficiente 3</small>
                                                    <InputNumber
                                                        value={coeficienteTres}
                                                        onChange={(e) => setCoeficienteTres(e.value)}
                                                        mode="decimal"
                                                        minFractionDigits={6}
                                                        className="w-full"
                                                        inputClassName="w-full"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    {errorMessage && (
                                        <small className="error-msg flex align-items-center mt-2 mb-2">
                                            <i className="fa-regular fa-circle-xmark mr-2"></i>
                                            {errorMessage}
                                        </small>
                                    )}

                                    <div
                                        className="flex w-full xl:w-3 mt-3 align-self-center"
                                        style={{ justifyContent: "center" }}
                                    >

                                        <Button
                                            label="Guardar"
                                            type="submit"
                                            size="small"
                                            rounded
                                            loading={saveLoading}
                                            disabled={saveLoading}
                                            icon="fa-solid fa-check"
                                        />

                                    </div>
                                </div>
                            </div>


                        </form>
                    </div>
                </div>
            </div>
        </Fade>
    );
};

export default PrensaForm;
