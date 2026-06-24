import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import { Divider } from "primereact/divider";
import { Message } from "primereact/message";
import { useToast } from "../../../../context/ToastContext";
import axios from "axios";
import { config } from "../../../../config/config";
import { Fade } from "react-awesome-reveal";
import PlantasMaterialSection from "../../../common/PlantasMaterialSection";
import FormField from "../../../common/FormField";

const TIPO_FUNCIONAL_OPTIONS = [
    { label: "Plastificante", value: "PLASTIFICANTE" },
    { label: "Reductor de agua rango medio", value: "REDUCTOR_AGUA_RANGO_MEDIO" },
    { label: "Superplastificante", value: "SUPERPLASTIFICANTE" },
    { label: "Fluidificante", value: "FLUIDIFICANTE" },
    { label: "Retardador", value: "RETARDADOR" },
    { label: "Controlador hidratación", value: "CONTROLADOR_HIDRATACION" },
    { label: "Incorporador de aire", value: "INCORPORADOR_AIRE" },
    { label: "Espumígeno (HRDC)", value: "ESPUMIGENO" },
    { label: "Otro", value: "OTRO" },
];

const UNIDAD_DOSIFICACION_OPTIONS = [
    { label: "% sobre cemento", value: "PORC_SOBRE_CEMENTO" },
    { label: "ml / 100 kg cemento", value: "ML_POR_100KG_CEMENTO" },
    { label: "kg/m³", value: "KG_M3" },
];

const MODO_EFECTO_OPTIONS = [
    { label: "Ahorro de agua", value: "AHORRO_AGUA" },
    { label: "Aumento de asentamiento", value: "AUMENTO_ASENTAMIENTO" },
    { label: "Retardante de fraguado", value: "RETARDANTE" },
    { label: "Acelerante de fraguado", value: "ACELERANTE_FRAGUE" },
    { label: "Acelerante de endurecimiento", value: "ACELERANTE_ENDURECIMIENTO" },
    { label: "Incorporador de aire", value: "INCORPORADOR_AIRE" },
    { label: "Espumígeno (HRDC)", value: "ESPUMIGENO" },
    { label: "Reductor de retracción", value: "REDUCTOR_RETRACCION" },
    { label: "Impermeabilizante", value: "IMPERMEABILIZANTE" },
    { label: "Viscosante", value: "VISCOSANTE" },
    { label: "Otro", value: "OTRO" },
];

const AditivoForm = ({ setDialogVisible, editAditivo, reload, setReload }) => {
    const { id } = useParams() || {};
    const isEditing = Boolean(id || editAditivo);

    /* ── Identificación ── */
    const [marca, setMarca] = useState("");
    const [fabrica, setFabrica] = useState("");
    const [funcion, setFuncion] = useState("");

    /* ── Clasificación funcional ── */
    const [tipoFuncional, setTipoFuncional] = useState(null);
    const [subtipo, setSubtipo] = useState("");
    const [baseQuimica, setBaseQuimica] = useState("");

    /* ── Propiedades físicas ── */
    const [densidad, setDensidad] = useState(null);
    const [solidosPct, setSolidosPct] = useState(null);
    const [idUnidadMedida, setIdUnidadMedida] = useState(null);

    /* ── Dosificación ── */
    const [unidadDosificacion, setUnidadDosificacion] = useState(null);
    const [dosisMinima, setDosisMinima] = useState(null);
    const [dosisHabitual, setDosisHabitual] = useState(null);
    const [dosisMaxima, setDosisMaxima] = useState(null);

    /* ── Efectos para el motor ── */
    const [reduccionAguaPctEsperada, setReduccionAguaPctEsperada] = useState(null);
    const [incrementoAsentamientoEsperado, setIncrementoAsentamientoEsperado] = useState(null);
    const [retencionTrabajabilidadMin, setRetencionTrabajabilidadMin] = useState(null);
    const [retardoEsperadoMin, setRetardoEsperadoMin] = useState(null);
    const [aireIncorporadoPctEsperado, setAireIncorporadoPctEsperado] = useState(null);
    const [modoEfectoSugerido, setModoEfectoSugerido] = useState(null);

    /* ── Otros ── */
    const [observaciones, setObservaciones] = useState("");

    /* ── Plantas ── */
    const [plantasConfig, setPlantasConfig] = useState([]);

    const [listaUnidades, setListaUnidades] = useState([]);
    const [saveLoading, setSaveLoading] = useState(false);
    const savingRef = useRef(false);
    const [errorMessage, setErrorMessage] = useState("");

    const showToast = useToast();

    /* ── Load unidades de medida ── */
    useEffect(() => {
        axios.get(`${config.backendUrl}/api/aditivos/unidadesmedida`, { headers: config.headers })
            .then((res) => setListaUnidades((res.data || []).map((u) => ({
                label: `${u.unidad} (${u.descripcion})`, value: u.idUnidadMedida,
            }))))
            .catch(() => showToast("error", "No se pudieron cargar las unidades de medida"));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    /* ── Load for editing ── */
    useEffect(() => {
        if (editAditivo) loadData(editAditivo);
        else if (id) {
            axios.get(`${config.backendUrl}/api/aditivos/${id}`, { headers: config.headers })
                .then((res) => loadData(res.data))
                .catch(() => showToast("error", "No se pudieron cargar los datos del aditivo"));
        }
    }, [editAditivo, id]); // eslint-disable-line react-hooks/exhaustive-deps

    const loadData = (a) => {
        setMarca(a.marca || "");
        setFabrica(a.fabrica || "");
        setFuncion(a.funcion || "");
        setTipoFuncional(a.tipoFuncional || null);
        setSubtipo(a.subtipo || "");
        setBaseQuimica(a.baseQuimica || "");
        setDensidad(a.densidad != null ? Number(a.densidad) : null);
        setSolidosPct(a.solidosPct != null ? Number(a.solidosPct) : null);
        setIdUnidadMedida(a.idUnidadMedida || null);
        setUnidadDosificacion(a.unidadDosificacion || null);
        setDosisMinima(a.dosisMinima != null ? Number(a.dosisMinima) : null);
        setDosisHabitual(a.dosisHabitual != null ? Number(a.dosisHabitual) : null);
        setDosisMaxima(a.dosisMaxima != null ? Number(a.dosisMaxima) : null);
        setReduccionAguaPctEsperada(a.reduccionAguaPctEsperada != null ? Number(a.reduccionAguaPctEsperada) : null);
        setIncrementoAsentamientoEsperado(a.incrementoAsentamientoEsperado != null ? Number(a.incrementoAsentamientoEsperado) : null);
        setRetencionTrabajabilidadMin(a.retencionTrabajabilidadMin || null);
        setRetardoEsperadoMin(a.retardoEsperadoMin || null);
        setAireIncorporadoPctEsperado(a.aireIncorporadoPctEsperado != null ? Number(a.aireIncorporadoPctEsperado) : null);
        setModoEfectoSugerido(a.modoEfectoSugerido || null);
        setObservaciones(a.observaciones || "");
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

    /* ── Apt for dosification check ── */
    const hasEffect = reduccionAguaPctEsperada || incrementoAsentamientoEsperado || aireIncorporadoPctEsperado || retardoEsperadoMin;
    const aptoParaDosificacion = tipoFuncional && densidad && unidadDosificacion && dosisMinima != null && dosisMaxima != null && hasEffect;

    /* ── Validation ── */
    const validar = () => {
        if (!marca.trim()) return "La marca es obligatoria.";
        if (!fabrica.trim()) return "La fábrica es obligatoria.";
        if (!idUnidadMedida) return "Debes elegir la unidad de medida.";
        return "";
    };

    /* ── Save ── */
    const guardar = async (e) => {
        e.preventDefault();
        if (savingRef.current) return;
        setErrorMessage("");
        savingRef.current = true;
        setSaveLoading(true);

        const error = validar();
        if (error) { setErrorMessage(error); savingRef.current = false; setSaveLoading(false); return; }

        const payload = {
            marca, fabrica, funcion,
            tipoFuncional, subtipo: subtipo || null, baseQuimica: baseQuimica || null,
            densidad, solidosPct,
            idUnidadMedida, unidadDosificacion,
            dosisMinima, dosisHabitual, dosisMaxima,
            reduccionAguaPctEsperada, incrementoAsentamientoEsperado,
            retencionTrabajabilidadMin, retardoEsperadoMin,
            aireIncorporadoPctEsperado, modoEfectoSugerido,
            observaciones: observaciones || null,
            plantasConfig: plantasConfig.map(p => ({
                idPlanta: p.idPlanta,
                activo: p.activo !== false,
                observaciones: p.observaciones || null,
            })),
        };

        try {
            let aditivoIdGuardado = id || editAditivo?.idAditivo;
            if (isEditing) {
                await axios.put(`${config.backendUrl}/api/aditivos/${aditivoIdGuardado}`, payload, { headers: config.headers });
                showToast("success", "Aditivo actualizado con éxito");
            } else {
                const r = await axios.post(`${config.backendUrl}/api/aditivos`, payload, { headers: config.headers });
                aditivoIdGuardado = r.data?.idAditivo || r.data?.id;
                showToast("success", "Aditivo creado con éxito");
            }

            const hoy = new Date().toISOString().slice(0, 10);
            for (const p of plantasConfig) {
                if (p.nuevoPrecio != null && Number(p.nuevoPrecio) > 0) {
                    try {
                        await axios.post(`${config.backendUrl}/api/material-precios`, {
                            materialSource: 'aditivo',
                            materialSourceId: aditivoIdGuardado,
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
            showToast("error", err.response?.data?.error || "Error al guardar el aditivo");
        } finally {
            savingRef.current = false;
            setSaveLoading(false);
        }
    };

    return (
        <Fade direction="up" duration={500} triggerOnce>
            <div className="flex w-full justify-content-center">
                <div className="p-0 py-4 xl:p-3 xl:pt-5 flex flex-column align-items-center w-full xl:w-9">
                    <div className="form-card-header w-full flex justify-content-between align-items-center">
                        <div>
                            <i className="fa-solid fa-droplet mr-2" />
                            {isEditing ? "Editar aditivo" : "Nuevo aditivo"}
                        </div>
                        <i className="fa-solid fa-circle-arrow-left cursor-pointer hover-red" style={{ fontSize: "1.2rem" }} onClick={() => window.history.back()} />
                    </div>

                    <form className="w-full flex flex-column align-items-center form-card pt-4 pb-5" onSubmit={guardar}>
                        <div className="w-full">

                            {/* ── SECCIÓN: Identificación ── */}
                            <h4 className="mt-0 mb-2"><i className="fa-solid fa-tag mr-2 text-primary" />Identificación</h4>
                            <div className="grid">
                                <FormField className="col-12 md:col-6" label="Marca / Nombre comercial" required>
                                    <InputText value={marca} onChange={(e) => setMarca(e.target.value)} className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Fabricante" required>
                                    <InputText value={fabrica} onChange={(e) => setFabrica(e.target.value)} className="w-full" />
                                </FormField>
                                <FormField className="col-12" label="Descripción / Función">
                                    <InputText value={funcion} onChange={(e) => setFuncion(e.target.value)} placeholder="Ej: Plastificante reductor de agua de alto rango" className="w-full" />
                                </FormField>
                            </div>

                            <Divider className="my-3" />

                            {/* ── SECCIÓN: Clasificación funcional ── */}
                            <h4 className="mt-0 mb-2"><i className="fa-solid fa-flask mr-2 text-primary" />Clasificación funcional</h4>
                            <div className="grid">
                                <FormField label="Tipo funcional">
                                    <Dropdown value={tipoFuncional} onChange={(e) => setTipoFuncional(e.value)} options={TIPO_FUNCIONAL_OPTIONS} placeholder="Seleccionar" className="w-full" showClear />
                                </FormField>
                                <FormField label="Subtipo">
                                    <InputText value={subtipo} onChange={(e) => setSubtipo(e.target.value)} placeholder="Ej: Policarboxilato" className="w-full" />
                                </FormField>
                                <FormField label="Base química">
                                    <InputText value={baseQuimica} onChange={(e) => setBaseQuimica(e.target.value)} placeholder="Ej: Naftaleno sulfonato" className="w-full" />
                                </FormField>
                            </div>

                            <Divider className="my-3" />

                            {/* ── SECCIÓN: Propiedades físicas ── */}
                            <h4 className="mt-0 mb-2"><i className="fa-solid fa-weight-hanging mr-2 text-primary" />Propiedades físicas</h4>
                            <div className="grid">
                                <FormField label="Densidad (g/cm³)">
                                    <InputNumber value={densidad} onValueChange={(e) => setDensidad(e.value)} min={0.5} max={3} minFractionDigits={2} maxFractionDigits={2} placeholder="Ej: 1.20" className="w-full" />
                                </FormField>
                                <FormField label="Sólidos (%)">
                                    <InputNumber value={solidosPct} onValueChange={(e) => setSolidosPct(e.value)} min={0} max={100} minFractionDigits={1} suffix="%" placeholder="Ej: 40" className="w-full" />
                                </FormField>
                                <FormField label="Unidad de medida" required>
                                    <Dropdown value={idUnidadMedida} onChange={(e) => setIdUnidadMedida(e.value)} options={listaUnidades} placeholder="Seleccionar" className="w-full" />
                                </FormField>
                            </div>

                            <Divider className="my-3" />

                            {/* ── SECCIÓN: Dosificación ── */}
                            <h4 className="mt-0 mb-2"><i className="fa-solid fa-eye-dropper mr-2 text-primary" />Dosificación</h4>
                            <div className="grid">
                                <FormField className="col-12 sm:col-6 lg:col-3" label="Unidad de dosificación">
                                    <Dropdown value={unidadDosificacion} onChange={(e) => setUnidadDosificacion(e.value)} options={UNIDAD_DOSIFICACION_OPTIONS} placeholder="Seleccionar" className="w-full" showClear />
                                </FormField>
                                <FormField className="col-12 sm:col-6 lg:col-3" label="Dosis mínima">
                                    <InputNumber value={dosisMinima} onValueChange={(e) => setDosisMinima(e.value)} minFractionDigits={2} className="w-full" />
                                </FormField>
                                <FormField className="col-12 sm:col-6 lg:col-3" label="Dosis recomendada">
                                    <InputNumber value={dosisHabitual} onValueChange={(e) => setDosisHabitual(e.value)} minFractionDigits={2} className="w-full" />
                                </FormField>
                                <FormField className="col-12 sm:col-6 lg:col-3" label="Dosis máxima">
                                    <InputNumber value={dosisMaxima} onValueChange={(e) => setDosisMaxima(e.value)} minFractionDigits={2} className="w-full" />
                                </FormField>
                            </div>

                            <Divider className="my-3" />

                            {/* ── SECCIÓN: Efectos para el motor ── */}
                            <h4 className="mt-0 mb-2"><i className="fa-solid fa-gears mr-2 text-primary" />Efectos esperados (motor de dosificación)</h4>
                            {!aptoParaDosificacion && (
                                <Message severity="warn" text="Este aditivo no tiene los datos técnicos mínimos para ser utilizado por el motor de dosificación. Complete al menos: tipo funcional, densidad, unidad de dosificación, dosis min/max y al menos un efecto esperado." className="mb-3 w-full" />
                            )}
                            <div className="grid">
                                <FormField label="Reducción de agua esperada (%)">
                                    <InputNumber value={reduccionAguaPctEsperada} onValueChange={(e) => setReduccionAguaPctEsperada(e.value)} min={0} max={50} minFractionDigits={1} suffix="%" placeholder="Ej: 15" className="w-full" />
                                </FormField>
                                <FormField label="Incremento asentamiento (mm)">
                                    <InputNumber value={incrementoAsentamientoEsperado} onValueChange={(e) => setIncrementoAsentamientoEsperado(e.value)} min={0} max={300} minFractionDigits={0} placeholder="Ej: 50" className="w-full" />
                                </FormField>
                                <FormField label="Aire incorporado esperado (%)">
                                    <InputNumber value={aireIncorporadoPctEsperado} onValueChange={(e) => setAireIncorporadoPctEsperado(e.value)} min={0} max={tipoFuncional === 'ESPUMIGENO' ? 40 : 10} minFractionDigits={1} suffix="%" placeholder={tipoFuncional === 'ESPUMIGENO' ? "Ej: 25" : "Ej: 4.5"} className="w-full" />
                                </FormField>
                                <FormField label="Retención trabajabilidad (min)">
                                    <InputNumber value={retencionTrabajabilidadMin} onValueChange={(e) => setRetencionTrabajabilidadMin(e.value)} min={0} max={300} placeholder="Ej: 60" className="w-full" />
                                </FormField>
                                <FormField label="Retardo esperado (min)">
                                    <InputNumber value={retardoEsperadoMin} onValueChange={(e) => setRetardoEsperadoMin(e.value)} min={0} max={300} placeholder="Ej: 30" className="w-full" />
                                </FormField>
                                <FormField label="Modo efecto sugerido">
                                    <Dropdown value={modoEfectoSugerido} onChange={(e) => setModoEfectoSugerido(e.value)} options={MODO_EFECTO_OPTIONS} placeholder="Seleccionar" className="w-full" showClear />
                                </FormField>
                            </div>

                            <Divider className="my-3" />

                            {/* ── SECCIÓN: Disponibilidad y precios por planta ── */}
                            <PlantasMaterialSection
                                value={plantasConfig}
                                onChange={setPlantasConfig}
                                tituloMaterial="este aditivo"
                            />

                            {/* ── SECCIÓN: Observaciones ── */}
                            <h4 className="mt-0 mb-2"><i className="fa-solid fa-comment mr-2 text-primary" />Observaciones</h4>
                            <InputTextarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} autoResize className="w-full" placeholder="Compatibilidad, notas técnicas, etc." />
                        </div>

                        {errorMessage && (
                            <small className="error-msg flex align-items-center mt-3 mb-2">
                                <i className="fa-regular fa-circle-xmark mr-2" />
                                {errorMessage}
                            </small>
                        )}

                        <div className="flex justify-content-center mt-4 w-full">
                            <Button label="Guardar" type="submit" rounded loading={saveLoading} disabled={saveLoading} icon="fa-solid fa-check" size="small" />
                        </div>
                    </form>
                </div>
            </div>
        </Fade>
    );
};

export default AditivoForm;
