import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import { InputSwitch } from "primereact/inputswitch";
import { useToast } from "../../../../context/ToastContext";
import axios from "axios";
import { config } from "../../../../config/config";
import { Fade } from "react-awesome-reveal";
import { Checkbox } from "primereact/checkbox";

const CATS = {
    CAMION_TRACTOR: "Camión Tractor",
    CAMION_MIXER: "Camión Mixer",
    CAMION_VOLCADOR: "Camión Volcador",
    SEMIRREMOLQUE: "Semirremolque",
    ACOPLADO: "Acoplado",
    MAQUINA: "Maquinaria",
    GRUPO_ELECTROGENO: "Grupo electrógeno",
    CAMIONETA: "Camioneta",
    AUTOMOVIL: "Automóvil",
    BOMBA_PLUMA: "Bomba pluma",
    BOMBA_ARRASTRE: "Bomba de arrastre",
};

const EquipoForm = ({ setDialogVisible, editEquipo, reload, setReload }) => {
    const { id } = useParams() || {};
    const isEditing = Boolean(id || editEquipo);

    const navigate = useNavigate();
    const showToast = useToast();

    const [categorias, setCategorias] = useState([]);

    const [idCategoriaVehiculo, setIdCategoriaVehiculo] = useState(null);
    const [marca, setMarca] = useState("");
    const [modelo, setModelo] = useState("");
    const [anio, setAnio] = useState(null);
    const [capacidad, setCapacidad] = useState(null);
    const [kilometros, setKilometros] = useState(null);
    const [horas, setHoras] = useState(null);
    const [vencimientoRto, setVencimientoRto] = useState(null);
    const [turnoRto, setTurnoRto] = useState(null);
    const [patente, setPatente] = useState("");
    const [interno, setInterno] = useState("");
    const [descripcion, setDescripcion] = useState("");
    const [potencia, setPotencia] = useState(null);
    const [numeroChasis, setNumeroChasis] = useState("");
    const [numeroMotor, setNumeroMotor] = useState("");
    const [color, setColor] = useState("");
    const [marcaRemolque, setMarcaRemolque] = useState("");
    const [modeloRemolque, setModeloRemolque] = useState("");
    const [idTipoSemirremolque, setIdTipoSemirremolque] = useState(null);
    const [idTipoAcoplado, setIdTipoAcoplado] = useState(null);
    const [idTipoMaquina, setIdTipoMaquina] = useState(null);
    const [idTipoGrupoElectrogeno, setIdTipoGrupoElectrogeno] = useState(null);
    const [nombre, setNombre] = useState("");
    const [tieneMotor, setTieneMotor] = useState(false);
    const [potenciaMotor, setPotenciaMotor] = useState(null);
    const [horasMotor, setHorasMotor] = useState(null);
    const [numeroMotorAnexado, setNumeroMotorAnexado] = useState("");
    const [potenciaGeneracion, setPotenciaGeneracion] = useState(null);
    const [tieneUrea, setTieneUrea] = useState(false);
    const [tieneHorometro, setTieneHorometro] = useState(false);

    const categoriaNombre = categorias.find(c => c.value === idCategoriaVehiculo)?.label;

    const [saveLoading, setSaveLoading] = useState(false);
    const savingRef = useRef(false);
    const [errorMessage, setErrorMessage] = useState("");

    const [tiposSemirremolque, setTiposSemirremolque] = useState([]);
    const [tiposGrupoElectrogeno, setTiposGrupoElectrogeno] = useState([]);
    const [tiposMaquina, setTiposMaquina] = useState([]);
    const [tiposAcoplado, setTiposAcoplado] = useState([]);

    useEffect(() => {
        const fetchCategorias = async () => {
            try {
                const res = await axios.get(`${config.backendUrl}/api/equipos/categorias`, {
                    headers: config.headers,
                });
                setCategorias(res.data.categoriasVehiculo.map((c) => ({ label: c.nombre, value: c.idCategoriaVehiculo })));
                setTiposSemirremolque(res.data.tiposSemirremolque.map((t) => ({ label: t.tipo, value: t.idTipoSemirremolque })));
                setTiposGrupoElectrogeno(res.data.tiposGrupoElectrogeno.map((t) => ({ label: t.tipo, value: t.idTipoGrupoElectrogeno })));
                setTiposMaquina(res.data.tiposMaquina.map((t) => ({ label: t.tipo, value: t.idTipoMaquina })));
                setTiposAcoplado(res.data.tiposAcoplado.map((t) => ({ label: t.tipo, value: t.idTipoAcoplado })));
            } catch (err) {
                console.error(err);
                showToast("error", "No se pudieron cargar las categorías");
            }
        };
        fetchCategorias();
    }, []);

    useEffect(() => {
        if (![CATS.CAMION_TRACTOR, CATS.CAMION_MIXER, CATS.CAMION_VOLCADOR, CATS.BOMBA_PLUMA, CATS.BOMBA_ARRASTRE].includes(categoriaNombre)) {
            setTieneUrea(false);
        }
    }, [categoriaNombre]);

    useEffect(() => {
        if (categoriaNombre === CATS.BOMBA_ARRASTRE) {
            setTieneHorometro(true);
        }
    }, [categoriaNombre]);

    useEffect(() => {
        if (editEquipo) {
            loadEquipo(editEquipo);
        } else if (id) {
            axios
                .get(`${config.backendUrl}/api/equipos/${id}`, { headers: config.headers })
                .then((res) => loadEquipo(res.data))
                .catch((err) => {
                    console.error(err);
                    showToast("error", "No se pudieron cargar los datos del equipo");
                });
        }
    }, [editEquipo, id]);

    const loadEquipo = (eq) => {
        setIdCategoriaVehiculo(eq.idCategoriaVehiculo || null);
        setMarca(eq.marca || "");
        setModelo(eq.modelo || "");
        setAnio(eq.anio ? new Date(eq.anio) : null);
        setCapacidad(eq.capacidad || null);
        setPatente(eq.patente || "");
        setInterno(eq.interno || "");
        setDescripcion(eq.descripcion || "");
        setKilometros(eq.kilometros || "");
        setHoras(eq.horas || "");
        setVencimientoRto(eq.vencimientoRto ? new Date(eq.vencimientoRto) : null);
        setTurnoRto(eq.turnoRto ? new Date(eq.turnoRto) : null);
        setPotencia(eq.potencia || null);
        setNumeroChasis(eq.numeroChasis || "");
        setNumeroMotor(eq.numeroMotor || "");
        setColor(eq.color || "");
        setMarcaRemolque(eq.marcaRemolque || "");
        setModeloRemolque(eq.modeloRemolque || "");
        setIdTipoSemirremolque(eq.idTipoSemirremolque || null);
        setIdTipoAcoplado(eq.idTipoAcoplado || null);
        setIdTipoMaquina(eq.idTipoMaquina || null);
        setIdTipoGrupoElectrogeno(eq.idTipoGrupoElectrogeno || null);
        setNombre(eq.nombre || "");
        setTieneMotor(eq.tieneMotor || false);
        setPotenciaMotor(eq.potenciaMotor || null);
        setHorasMotor(eq.horasMotor || null);
        setNumeroMotorAnexado(eq.numeroMotorAnexado || "");
        setPotenciaGeneracion(eq.potenciaGeneracion || null);
        setTieneUrea(!!eq.tieneUrea);
        setTieneHorometro(!!eq.tieneHorometro);
    };

    const validar = () => {
        if (!idCategoriaVehiculo) return "Selecciona la categoría";

        const faltantes = [];
        if (!marca?.trim()) faltantes.push("la marca");
        if (!modelo?.trim()) faltantes.push("el modelo");
        if (!patente?.trim()) faltantes.push("la patente");

        if (faltantes.length === 1) return `Falta completar ${faltantes[0]}`;
        if (faltantes.length > 1) {
            const ultimo = faltantes.pop();
            return `Faltan completar ${faltantes.join(", ")} y ${ultimo}`;
        }
        return "";
    };

    const buildPayload = () => ({
        idCategoriaVehiculo,
        marca,
        modelo,
        anio,
        capacidad,
        patente,
        interno,
        descripcion,
        kilometros,
        horas,
        vencimientoRto,
        turnoRto,
        potencia,
        numeroChasis,
        numeroMotor,
        color,
        marcaRemolque,
        modeloRemolque,
        idTipoSemirremolque,
        idTipoAcoplado,
        idTipoMaquina,
        idTipoGrupoElectrogeno,
        nombre,
        tieneMotor,
        potenciaMotor,
        horasMotor,
        numeroMotorAnexado,
        potenciaGeneracion,
        tieneUrea,
        tieneHorometro,
    });

    const tractorFields = (
        <>
            <div className="flex flex-column col-12 md:col-6">
                <small><span className="eq-required">*</span> Marca</small>
                <InputText value={marca} onChange={(e) => setMarca(e.target.value)} />
            </div>
            <div className="flex flex-column col-12 md:col-6">
                <small><span className="eq-required">*</span> Modelo</small>
                <InputText value={modelo} onChange={(e) => setModelo(e.target.value)} />
            </div>
            <div className="flex flex-column col-12 md:col-6">
                <small>Año</small>
                <Calendar value={anio} onChange={(e) => setAnio(e.value)} dateFormat="yy" view="year" placeholder="Año" />
            </div>
            <div className="flex flex-column col-12 md:col-6">
                <small>Potencia</small>
                <InputNumber value={potencia} onChange={(e) => setPotencia(e.value)} />
            </div>
            <div className="flex flex-column col-12 md:col-6">
                <small>Número de chasis</small>
                <InputText value={numeroChasis} onChange={(e) => setNumeroChasis(e.target.value)} />
            </div>
            <div className="flex flex-column col-12 md:col-6">
                <small>Número de motor</small>
                <InputText value={numeroMotor} onChange={(e) => setNumeroMotor(e.target.value)} />
            </div>
            <div className="flex flex-column col-12 md:col-6">
                <small>Interno</small>
                <InputText value={interno} onChange={(e) => setInterno(e.target.value)} />
            </div>
            <div className="flex flex-column col-12 md:col-6">
                <small>Color</small>
                <InputText value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
            <div className="flex flex-column col-12 md:col-6">
                <small>Horas</small>
                <InputNumber value={horas} onChange={(e) => setHoras(e.value)} />
            </div>
            <div className="flex flex-column col-12 md:col-6">
                <small>Kilómetros</small>
                <InputNumber value={kilometros} onChange={(e) => setKilometros(e.value)} />
            </div>
            <div className="flex flex-column col-12 md:col-6">
                <small>Vencimiento RTO</small>
                <Calendar value={vencimientoRto} onChange={(e) => setVencimientoRto(e.value)} dateFormat="dd/mm/yy" placeholder="dd/mm/aaaa" />
            </div>
            <div className="flex flex-column col-12 md:col-6">
                <small>Turno RTO</small>
                <Calendar value={turnoRto} onChange={(e) => setTurnoRto(e.value)} dateFormat="dd/mm/yy" placeholder="dd/mm/aaaa" />
            </div>
            <div className="flex align-items-center col-12 md:col-6">
                <Checkbox inputId="tieneUrea" checked={tieneUrea} onChange={(e) => setTieneUrea(e.checked)} className="mr-2" />
                <label htmlFor="tieneUrea">¿Lleva urea?</label>
            </div>
            <div className="flex align-items-center col-12 md:col-6">
                <Checkbox inputId="tieneHorometro" checked={tieneHorometro} onChange={(e) => setTieneHorometro(e.checked)} className="mr-2" />
                <label htmlFor="tieneHorometro">¿Tiene horómetro?</label>
            </div>
        </>
    );

    const renderCategoriaFields = () => {
        switch (categoriaNombre) {
            case CATS.CAMION_TRACTOR:
                return tractorFields;
            case CATS.CAMION_MIXER:
                return (
                    <>
                        {tractorFields}
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Capacidad de carga</small>
                            <InputNumber value={capacidad} onChange={(e) => setCapacidad(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Marca Mixer</small>
                            <InputText value={marcaRemolque} onChange={(e) => setMarcaRemolque(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Modelo Mixer</small>
                            <InputText value={modeloRemolque} onChange={(e) => setModeloRemolque(e.target.value)} />
                        </div>
                    </>
                );
            case CATS.CAMION_VOLCADOR:
                return (
                    <>
                        {tractorFields}
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Capacidad de carga</small>
                            <InputNumber value={capacidad} onChange={(e) => setCapacidad(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Marca Volcadora</small>
                            <InputText value={marcaRemolque} onChange={(e) => setMarcaRemolque(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Modelo Volcadora</small>
                            <InputText value={modeloRemolque} onChange={(e) => setModeloRemolque(e.target.value)} />
                        </div>
                    </>
                );
            case CATS.SEMIRREMOLQUE:
                return (
                    <>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Tipo</small>
                            <Dropdown value={idTipoSemirremolque} onChange={(e) => setIdTipoSemirremolque(e.value)} options={tiposSemirremolque} placeholder="Selecciona" className="w-full" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Marca</small>
                            <InputText value={marca} onChange={(e) => setMarca(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Modelo</small>
                            <InputText value={modelo} onChange={(e) => setModelo(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Año</small>
                            <Calendar value={anio} onChange={(e) => setAnio(e.value)} dateFormat="yy" view="year" placeholder="Año" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Capacidad de carga</small>
                            <InputNumber value={capacidad} onChange={(e) => setCapacidad(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de chasis</small>
                            <InputText value={numeroChasis} onChange={(e) => setNumeroChasis(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Interno</small>
                            <InputText value={interno} onChange={(e) => setInterno(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Vencimiento RTO</small>
                            <Calendar value={vencimientoRto} onChange={(e) => setVencimientoRto(e.value)} dateFormat="dd/mm/yy" placeholder="dd/mm/aaaa" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Turno RTO</small>
                            <Calendar value={turnoRto} onChange={(e) => setTurnoRto(e.value)} dateFormat="dd/mm/yy" placeholder="dd/mm/aaaa" />
                        </div>
                        <div className="flex align-items-center justify-content-center col-12 md:col-6">
                            <label className="mr-2">¿Tiene motor?</label>
                            <InputSwitch checked={tieneMotor} onChange={(e) => setTieneMotor(e.value)} />
                        </div>

                        {tieneMotor && (
                            <>
                                <div className="flex flex-column col-12 md:col-6">
                                    <small>Potencia motor</small>
                                    <InputNumber value={potenciaMotor} onChange={(e) => setPotenciaMotor(e.value)} />
                                </div>
                                <div className="flex flex-column col-12 md:col-6">
                                    <small>Horas motor</small>
                                    <InputNumber value={horasMotor} onChange={(e) => setHorasMotor(e.value)} />
                                </div>
                                <div className="flex flex-column col-12 md:col-6">
                                    <small>Número de motor</small>
                                    <InputText value={numeroMotorAnexado} onChange={(e) => setNumeroMotorAnexado(e.target.value)} />
                                </div>
                            </>
                        )}
                    </>
                );
            case CATS.ACOPLADO:
                return (
                    <>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Tipo</small>
                            <Dropdown value={idTipoAcoplado} onChange={(e) => setIdTipoAcoplado(e.value)} options={tiposAcoplado} placeholder="Selecciona" className="w-full" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Marca</small>
                            <InputText value={marca} onChange={(e) => setMarca(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Modelo</small>
                            <InputText value={modelo} onChange={(e) => setModelo(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Año</small>
                            <Calendar value={anio} onChange={(e) => setAnio(e.value)} dateFormat="yy" view="year" placeholder="Año" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Capacidad de carga</small>
                            <InputNumber value={capacidad} onChange={(e) => setCapacidad(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de chasis</small>
                            <InputText value={numeroChasis} onChange={(e) => setNumeroChasis(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Interno</small>
                            <InputText value={interno} onChange={(e) => setInterno(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Vencimiento RTO</small>
                            <Calendar value={vencimientoRto} onChange={(e) => setVencimientoRto(e.value)} dateFormat="dd/mm/yy" placeholder="dd/mm/aaaa" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Turno RTO</small>
                            <Calendar value={turnoRto} onChange={(e) => setTurnoRto(e.value)} dateFormat="dd/mm/yy" placeholder="dd/mm/aaaa" />
                        </div>
                    </>
                );
            case CATS.MAQUINA:
                return (
                    <>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Tipo</small>
                            <Dropdown value={idTipoMaquina} onChange={(e) => setIdTipoMaquina(e.value)} options={tiposMaquina} placeholder="Selecciona" className="w-full" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Nombre</small>
                            <InputText value={nombre} onChange={(e) => setNombre(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Marca</small>
                            <InputText value={marca} onChange={(e) => setMarca(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Modelo</small>
                            <InputText value={modelo} onChange={(e) => setModelo(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Año</small>
                            <Calendar value={anio} onChange={(e) => setAnio(e.value)} dateFormat="yy" view="year" placeholder="Año" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Horas</small>
                            <InputNumber value={horas} onChange={(e) => setHoras(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Potencia</small>
                            <InputNumber value={potencia} onChange={(e) => setPotencia(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Capacidad de carga</small>
                            <InputNumber value={capacidad} onChange={(e) => setCapacidad(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de chasis</small>
                            <InputText value={numeroChasis} onChange={(e) => setNumeroChasis(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de motor</small>
                            <InputText value={numeroMotor} onChange={(e) => setNumeroMotor(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Interno</small>
                            <InputText value={interno} onChange={(e) => setInterno(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Color</small>
                            <InputText value={color} onChange={(e) => setColor(e.target.value)} />
                        </div>
                        <div className="flex align-items-center col-12 md:col-6">
                            <Checkbox inputId="tieneHorometro" checked={tieneHorometro} onChange={(e) => setTieneHorometro(e.checked)} className="mr-2" />
                            <label htmlFor="tieneHorometro">¿Tiene horómetro?</label>
                        </div>
                    </>
                );
            case CATS.GRUPO_ELECTROGENO:
                return (
                    <>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Tipo</small>
                            <Dropdown value={idTipoGrupoElectrogeno} onChange={(e) => setIdTipoGrupoElectrogeno(e.value)} options={tiposGrupoElectrogeno} placeholder="Selecciona" className="w-full" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Nombre</small>
                            <InputText value={nombre} onChange={(e) => setNombre(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Marca</small>
                            <InputText value={marca} onChange={(e) => setMarca(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Modelo</small>
                            <InputText value={modelo} onChange={(e) => setModelo(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Marca Motor</small>
                            <InputText value={marcaRemolque} onChange={(e) => setMarcaRemolque(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Modelo Motor</small>
                            <InputText value={modeloRemolque} onChange={(e) => setModeloRemolque(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Año</small>
                            <Calendar value={anio} onChange={(e) => setAnio(e.value)} dateFormat="yy" view="year" placeholder="Año" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Horas</small>
                            <InputNumber value={horas} onChange={(e) => setHoras(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Potencia</small>
                            <InputNumber value={potencia} onChange={(e) => setPotencia(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Potencia de generación</small>
                            <InputNumber value={potenciaGeneracion} onChange={(e) => setPotenciaGeneracion(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de chasis</small>
                            <InputText value={numeroChasis} onChange={(e) => setNumeroChasis(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de motor</small>
                            <InputText value={numeroMotor} onChange={(e) => setNumeroMotor(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Interno</small>
                            <InputText value={interno} onChange={(e) => setInterno(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Color</small>
                            <InputText value={color} onChange={(e) => setColor(e.target.value)} />
                        </div>
                        <div className="flex align-items-center col-12 md:col-6">
                            <Checkbox inputId="tieneHorometro" checked={tieneHorometro} onChange={(e) => setTieneHorometro(e.checked)} className="mr-2" />
                            <label htmlFor="tieneHorometro">¿Tiene horómetro?</label>
                        </div>
                    </>
                );
            case CATS.CAMIONETA:
                return (
                    <>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Marca</small>
                            <InputText value={marca} onChange={(e) => setMarca(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Modelo</small>
                            <InputText value={modelo} onChange={(e) => setModelo(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Año</small>
                            <Calendar value={anio} onChange={(e) => setAnio(e.value)} dateFormat="yy" view="year" placeholder="Año" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Kilómetros</small>
                            <InputNumber value={kilometros} onChange={(e) => setKilometros(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Potencia</small>
                            <InputNumber value={potencia} onChange={(e) => setPotencia(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Capacidad de carga</small>
                            <InputNumber value={capacidad} onChange={(e) => setCapacidad(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de chasis</small>
                            <InputText value={numeroChasis} onChange={(e) => setNumeroChasis(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de motor</small>
                            <InputText value={numeroMotor} onChange={(e) => setNumeroMotor(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Interno</small>
                            <InputText value={interno} onChange={(e) => setInterno(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Color</small>
                            <InputText value={color} onChange={(e) => setColor(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Vencimiento RTO</small>
                            <Calendar value={vencimientoRto} onChange={(e) => setVencimientoRto(e.value)} dateFormat="dd/mm/yy" placeholder="dd/mm/aaaa" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Turno RTO</small>
                            <Calendar value={turnoRto} onChange={(e) => setTurnoRto(e.value)} dateFormat="dd/mm/yy" placeholder="dd/mm/aaaa" />
                        </div>
                    </>
                );
            case CATS.AUTOMOVIL:
                return (
                    <>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Marca</small>
                            <InputText value={marca} onChange={(e) => setMarca(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Modelo</small>
                            <InputText value={modelo} onChange={(e) => setModelo(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Año</small>
                            <Calendar value={anio} onChange={(e) => setAnio(e.value)} dateFormat="yy" view="year" placeholder="Año" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Kilómetros</small>
                            <InputNumber value={kilometros} onChange={(e) => setKilometros(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Potencia</small>
                            <InputNumber value={potencia} onChange={(e) => setPotencia(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de chasis</small>
                            <InputText value={numeroChasis} onChange={(e) => setNumeroChasis(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de motor</small>
                            <InputText value={numeroMotor} onChange={(e) => setNumeroMotor(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Interno</small>
                            <InputText value={interno} onChange={(e) => setInterno(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Color</small>
                            <InputText value={color} onChange={(e) => setColor(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Vencimiento RTO</small>
                            <Calendar value={vencimientoRto} onChange={(e) => setVencimientoRto(e.value)} dateFormat="dd/mm/yy" placeholder="dd/mm/aaaa" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Turno RTO</small>
                            <Calendar value={turnoRto} onChange={(e) => setTurnoRto(e.value)} dateFormat="dd/mm/yy" placeholder="dd/mm/aaaa" />
                        </div>
                    </>
                );
            case CATS.BOMBA_PLUMA:
                return (
                    <>
                        {tractorFields}
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Capacidad de bombeo</small>
                            <InputNumber value={capacidad} onChange={(e) => setCapacidad(e.value)} />
                        </div>
                    </>
                );
            case CATS.BOMBA_ARRASTRE:
                return (
                    <>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Marca</small>
                            <InputText value={marca} onChange={(e) => setMarca(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small><span className="eq-required">*</span> Modelo</small>
                            <InputText value={modelo} onChange={(e) => setModelo(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Año</small>
                            <Calendar value={anio} onChange={(e) => setAnio(e.value)} dateFormat="yy" view="year" placeholder="Año" />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Potencia</small>
                            <InputNumber value={potencia} onChange={(e) => setPotencia(e.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de chasis</small>
                            <InputText value={numeroChasis} onChange={(e) => setNumeroChasis(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Número de motor</small>
                            <InputText value={numeroMotor} onChange={(e) => setNumeroMotor(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Interno</small>
                            <InputText value={interno} onChange={(e) => setInterno(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Color</small>
                            <InputText value={color} onChange={(e) => setColor(e.target.value)} />
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Horas</small>
                            <InputNumber value={horas} onChange={(e) => setHoras(e.value)} />
                        </div>
                        <div className="flex align-items-center col-12 md:col-6">
                            <Checkbox inputId="tieneUrea" checked={tieneUrea} onChange={(e) => setTieneUrea(e.checked)} className="mr-2" />
                            <label htmlFor="tieneUrea">¿Lleva urea?</label>
                        </div>
                        <div className="flex flex-column col-12 md:col-6">
                            <small>Capacidad de bombeo</small>
                            <InputNumber value={capacidad} onChange={(e) => setCapacidad(e.value)} />
                        </div>
                    </>
                );
            default:
                return null;
        }
    };


    const guardarEquipo = async (e) => {
        e.preventDefault();
        if (savingRef.current) return;
        setErrorMessage("");
        const err = validar();
        if (err) {
            setErrorMessage(err);
            return;
        }
        savingRef.current = true;
        setSaveLoading(true);
        const payload = buildPayload();
        try {
            if (isEditing) {
                const equipoId = id || editEquipo?.idVehiculo;
                await axios.put(`${config.backendUrl}/api/equipos/${equipoId}`, payload, { headers: config.headers });
                showToast("success", "Equipo actualizado con éxito");
            } else {
                await axios.post(`${config.backendUrl}/api/equipos`, payload, { headers: config.headers });
                showToast("success", "Equipo creado con éxito");
            }
            if (setReload) setReload(true);
            if (setDialogVisible) {
                setDialogVisible(false);
            } else {
                navigate("/flota/equipos");
            }
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.error || "Error al guardar el equipo";
            setErrorMessage(msg);
            showToast("error", msg);
        } finally {
            savingRef.current = false;
            setSaveLoading(false);
        }
    };

    return (
        <Fade direction="up" duration={500} triggerOnce className="w-full">
            <div className="flex w-full justify-content-center">
                <div className="p-0 py-4 xl:p-3 xl:pt-5 flex flex-column justify-self-center align-items-center w-full xl:w-8">
                    <div className="form-card-header w-full align-self-start align-items-center justify-content-between mt-0 text-center flex">
                        <div>
                            <i className="fa-solid fa-truck mr-2"></i>
                            <span>{isEditing ? "Editar equipo" : "Nuevo equipo"}</span>
                        </div>
                        <i
                            className="fa-solid fa-circle-arrow-left cursor-pointer hover-red"
                            style={{ fontSize: "1.2rem" }}
                            onClick={() => navigate("/flota/equipos")}
                        ></i>
                    </div>

                    <form className="eq-form w-full form-card pb-4" onSubmit={guardarEquipo}>
                        {/* Sección 1: Identificación */}
                        <div className="eq-form-section">
                            <div className="eq-form-section-header">
                                <i className="fa-solid fa-id-card"></i>
                                <span>Identificación</span>
                            </div>
                            <div className="flex flex-wrap">
                                <div className="flex flex-column col-12 md:col-6">
                                    <small><span className="eq-required">*</span> Categoría</small>
                                    <Dropdown
                                        value={idCategoriaVehiculo}
                                        onChange={(e) => setIdCategoriaVehiculo(e.value)}
                                        options={categorias}
                                        placeholder="Seleccioná la categoría"
                                        className="w-full"
                                        filter
                                    />
                                </div>
                                <div className="flex flex-column col-12 md:col-6">
                                    <small><span className="eq-required">*</span> Patente</small>
                                    <InputText
                                        value={patente}
                                        onChange={(e) => setPatente(e.target.value.toUpperCase())}
                                        placeholder="Ej. AB123CD"
                                        maxLength={10}
                                    />
                                </div>
                                {!idCategoriaVehiculo && (
                                    <div className="col-12">
                                        <span className="eq-form-hint">
                                            <i className="fa-solid fa-circle-info"></i>
                                            Los campos se adaptan según la categoría que selecciones
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Sección 2: Datos del equipo (dinámico según categoría) */}
                        {idCategoriaVehiculo ? (
                            <div className="eq-form-section">
                                <div className="eq-form-section-header">
                                    <i className="fa-solid fa-screwdriver-wrench"></i>
                                    <span>Datos del equipo</span>
                                    {categoriaNombre && <span className="eq-form-section-tag">{categoriaNombre}</span>}
                                </div>
                                <div className="flex flex-wrap">
                                    {renderCategoriaFields()}
                                </div>
                            </div>
                        ) : (
                            <div className="eq-form-empty-hint">
                                <i className="fa-solid fa-arrow-up"></i>
                                <span>Seleccioná una categoría para cargar los datos del equipo</span>
                            </div>
                        )}

                        {/* Sección 3: Descripción */}
                        {idCategoriaVehiculo && (
                            <div className="eq-form-section">
                                <div className="eq-form-section-header">
                                    <i className="fa-solid fa-file-lines"></i>
                                    <span>Descripción</span>
                                    <span className="eq-label-hint">(opcional)</span>
                                </div>
                                <div className="flex flex-wrap">
                                    <div className="flex flex-column col-12">
                                        <InputText
                                            value={descripcion}
                                            onChange={(e) => setDescripcion(e.target.value)}
                                            placeholder="Notas adicionales sobre el equipo"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {errorMessage && (
                            <div className="eq-form-error">
                                <i className="fa-solid fa-circle-exclamation"></i>
                                <span>{errorMessage}</span>
                            </div>
                        )}

                        <div className="flex justify-content-center col-12 mt-3 gap-2">
                            <Button
                                label="Cancelar"
                                type="button"
                                size="small"
                                severity="secondary"
                                rounded
                                outlined
                                onClick={() => navigate("/flota/equipos")}
                            />
                            <Button
                                label={isEditing ? 'Guardar cambios' : 'Crear equipo'}
                                type="submit"
                                size="small"
                                rounded
                                loading={saveLoading}
                                disabled={saveLoading}
                                icon="fa-solid fa-check"
                            />
                        </div>
                    </form>
                </div>
            </div>
        </Fade>
    );
};

export default EquipoForm;