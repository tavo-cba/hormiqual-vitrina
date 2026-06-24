import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { RadioButton } from "primereact/radiobutton";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { useToast } from "../../../../context/ToastContext";
import axios from "axios";
import { config } from "../../../../config/config";
import { Fade } from "react-awesome-reveal";
import { getAgregadoMeta, upsertAgregadoMeta } from "../../../../services/agregadoEnsayoService";
import PlantasMaterialSection from "../../../common/PlantasMaterialSection";
import FormField from "../../../common/FormField";

const SUBTIPO_GRUESO_OPTIONS = [
    { label: "Canto rodado natural", value: "CANTO_RODADO" },
    { label: "Triturado natural", value: "TRITURADO_NATURAL" },
    { label: "Triturado artificial", value: "TRITURADO_ARTIFICIAL" },
    { label: "Escoria de alto horno", value: "ESCORIA_ALTO_HORNO" },
    { label: "Liviano (IRAM 1567)", value: "LIVIANO" },
];

const SUBTIPO_FINO_OPTIONS = [
    { label: "Arena natural", value: "ARENA_NATURAL" },
    { label: "Arena de trituración", value: "ARENA_TRITURACION" },
    { label: "Mezcla (natural + trituración)", value: "ARENA_MEZCLA" },
];

const AgregadoForm = ({ setDialogVisible, editAgregado, reload, setReload }) => {
    const { tipo, id } = useParams() || {};
    const isEditing = Boolean(id || editAgregado);

    const [tipoAgregado, setTipoAgregado] = useState("Fino"); // "Fino" o "Grueso"

    // Campos de la tabla Agregado (comunes — solo datos administrativos)
    const [nombre, setNombre] = useState("");
    const [origen, setOrigen] = useState("");

    // Campos de AgregadoMeta (extendidos — modelo unificado)
    const [cantera, setCantera] = useState("");
    const [productor, setProductor] = useState("");
    const [nroExpediente, setNroExpediente] = useState("");
    const [subtipoMaterial, setSubtipoMaterial] = useState(null);
    const [tipoRoca, setTipoRoca] = useState(null);
    // PR — RAS dejó de ser un dato estático del agregado. Ahora se evalúa
    // automáticamente desde los ensayos cargados (IRAM 1649 petrográfico,
    // 1674 mortero acelerado, 1700 prismas) vía rasEvalEngine. Si querés
    // ver el último valor evaluado, mirá la ficha técnica del agregado.

    // PR4 — Multi-planta: el agregado puede asignarse a 1+ plantas vía
    // pivote MaterialPlanta. La columna `Agregado.idPlanta` legacy queda como
    // caché de la primera planta activa.
    const [plantasConfig, setPlantasConfig] = useState([]);

    // Control
    const [saveLoading, setSaveLoading] = useState(false);
    const savingRef = useRef(false);
    const [errorMessage, setErrorMessage] = useState("");

    const showToast = useToast();

    // ----------------------------------------------------
    // 1. Cargar el Agregado si editamos
    useEffect(() => {
        if (editAgregado) {
            setTipoAgregado(editAgregado.tipoAgregado);
            loadAgregadoData(editAgregado);
        } else if (id && tipo) {
            axios
                .get(`${config.backendUrl}/api/agregados/${id}?tipoAgregado=${tipo}`, { headers: config.headers })
                .then((res) => {
                    setTipoAgregado(tipo);
                    loadAgregadoData(res.data);
                })
                .catch((err) => {
                    console.error(err);
                    showToast("error", "No se pudieron cargar los datos del agregado");
                });
        }
    }, [editAgregado, id, tipo]);

    const loadAgregadoData = (agr) => {
        setNombre(agr.nombre || "");
        setOrigen(agr.origen || "");
        // PR4 — Cargar plantas asignadas (si vienen con el GET enriquecido).
        // Back-compat: si el agregado solo trae `idPlanta` legacy, sintetizamos
        // un row.
        if (Array.isArray(agr.plantas) && agr.plantas.length > 0) {
            setPlantasConfig(agr.plantas.map(p => ({
                idPlanta: p.idPlanta,
                nombrePlanta: p.planta?.nombre || `Planta ${p.idPlanta}`,
                activo: p.activo !== false,
                observaciones: p.observaciones || null,
            })));
        } else if (agr.idPlanta) {
            setPlantasConfig([{
                idPlanta: agr.idPlanta,
                nombrePlanta: agr.planta?.nombre || `Planta ${agr.idPlanta}`,
                activo: true,
                observaciones: null,
            }]);
        }
        // Load meta
        const agregadoId = agr.id || agr.idAgregado;
        if (agregadoId) {
            getAgregadoMeta(agregadoId)
                .then((meta) => {
                    if (meta) {
                        setCantera(meta.cantera || "");
                        setProductor(meta.productor || "");
                        setNroExpediente(meta.nroExpediente || meta.nroRegistroMinero || "");
                        setSubtipoMaterial(meta.subtipoMaterial || meta.tipoGruesoOrigen || null);
                        setTipoRoca(meta.tipoRoca || null);
                    }
                })
                .catch(() => { /* non-critical */ });
        }
    };

    // ----------------------------------------------------
    // 3. Validaciones
    const validarFormulario = () => {
        if (!nombre) return "El campo 'nombre' es obligatorio.";
        if (!tipoAgregado) return "Debes elegir el tipo de agregado (Fino o Grueso).";
        if (!productor || !productor.trim()) return "El campo 'productor' es obligatorio.";
        if (!subtipoMaterial) return "Debes seleccionar el subtipo de material.";
        return "";
    };

    const buildPayload = () => {
        return {
            nombre,
            tipoAgregado,
            origen,
            // PR4 — Multi-planta: el backend acepta plantasConfig y mantiene
            // Agregado.idPlanta legacy en sync con la primera planta activa.
            plantasConfig: plantasConfig.map(p => ({
                idPlanta: p.idPlanta,
                activo: p.activo !== false,
                observaciones: p.observaciones || null,
            })),
        };
    };

    // ----------------------------------------------------
    // 4. Guardar
    const guardarAgregado = async (e) => {
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

        const payload = buildPayload();

        try {
            let agregadoId;
            if (isEditing) {
                agregadoId = id || editAgregado?.id;
                await axios.put(`${config.backendUrl}/api/agregados/${agregadoId}`, payload, {
                    headers: config.headers,
                });
                showToast("success", "Agregado actualizado con éxito");
            } else {
                const res = await axios.post(`${config.backendUrl}/api/agregados`, payload, {
                    headers: config.headers,
                });
                agregadoId = res.data?.id || res.data?.idAgregado;
                showToast("success", "Agregado creado con éxito");
            }

            // Guardar metadatos extendidos (subtipoMaterial, cantera, productor, etc.)
            if (agregadoId) {
                try {
                    await upsertAgregadoMeta(agregadoId, {
                        subtipoMaterial,
                        cantera: cantera || null,
                        productor: productor.trim(),
                        nroExpediente: nroExpediente || null,
                        tipoAgregado,
                        tipoRoca: tipoRoca || null,
                    });
                } catch (metaErr) {
                    console.warn("Error al guardar metadatos del agregado:", metaErr);
                }
            }

            if (setReload) setReload(true);
            if (setDialogVisible) {
                setDialogVisible(false);
            } else {
                window.history.back();
            }
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.error || "Error al guardar el agregado";
            showToast("error", msg);
        } finally {
            savingRef.current = false;
            setSaveLoading(false);
        }
    };

    // ----------------------------------------------------
    return (
        <Fade direction="up" duration={500} triggerOnce className="w-full">
            <div className="flex w-full justify-content-center">
                <div className="p-0 py-4 xl:p-3 xl:pt-5  flex flex-column justify-self-center align-items-center w-full xl:w-9">
                    <div className="form-card-header w-full align-self-start align-items-center justify-content-between mt-0 text-center flex">
                        <div>
                            <i className="fa-solid fa-hill-rockslide mr-2"></i>
                            <span>{isEditing ? "Editar agregado" : "Nuevo agregado"}</span>
                        </div>
                        <i
                            className="fa-solid fa-circle-arrow-left cursor-pointer hover-red"
                            style={{ fontSize: "1.2rem" }}
                            onClick={() => window.history.back()}
                        ></i>
                    </div>

                    <form className="w-full flex flex-column align-items-center form-card pt-5 pb-5 gap-2" onSubmit={guardarAgregado}>
                        {/* Tipo de agregado (solo modificable si NO estamos editando) */}
                        {!isEditing && (
                            <div className="mb-3">
                                <small>Tipo de Agregado</small>
                                <div className="flex gap-3 mt-2">
                                    {["Fino", "Grueso"].map((op) => (
                                        <div key={op} className="flex align-items-center">
                                            <RadioButton
                                                inputId={op}
                                                name="tipoAgregado"
                                                value={op}
                                                onChange={(e) => { setTipoAgregado(e.value); setSubtipoMaterial(null); }}
                                                checked={tipoAgregado === op}
                                            />
                                            <label htmlFor={op} className="ml-2">
                                                {op}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="w-full">
                            <div className="grid">
                                <FormField className="col-12 md:col-6" label="Nombre" required>
                                    <InputText value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Productor" required>
                                    <InputText value={productor} onChange={(e) => setProductor(e.target.value)} placeholder="Nombre del productor" className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Subtipo de material" required>
                                    <Dropdown
                                        value={subtipoMaterial}
                                        onChange={(e) => setSubtipoMaterial(e.value)}
                                        options={tipoAgregado === "Grueso" ? SUBTIPO_GRUESO_OPTIONS : SUBTIPO_FINO_OPTIONS}
                                        placeholder="Selecciona"
                                        className="w-full"
                                    />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Cantera">
                                    <InputText value={cantera} onChange={(e) => setCantera(e.target.value)} placeholder="Nombre de la cantera" className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Nº Expediente">
                                    <InputText value={nroExpediente} onChange={(e) => setNroExpediente(e.target.value)} placeholder="Número de expediente" className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Origen">
                                    <InputText value={origen} onChange={(e) => setOrigen(e.target.value)} placeholder="Descripción libre de origen" className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Tipo de roca (litología)">
                                    <Dropdown
                                        value={tipoRoca}
                                        onChange={(e) => setTipoRoca(e.value)}
                                        options={[
                                            { label: 'Granítica', value: 'GRANITICA' },
                                            { label: 'Basáltica', value: 'BASALTICA' },
                                            { label: 'Calcárea', value: 'CALCAREA' },
                                            { label: 'Cuarcítica', value: 'CUARCITICA' },
                                            { label: 'Otra', value: 'OTRA' },
                                        ]}
                                        placeholder="Selecciona tipo de roca"
                                        className="w-full"
                                        showClear
                                        title="Determina si se requiere ensayo IRAM 1519 (estabilidad basálticas)"
                                    />
                                </FormField>
                            </div>
                        </div>

                        {/* PR4 — Multi-planta: el agregado puede asignarse a 1+ plantas
                             para que el motor de dosificación lo ofrezca como material
                             constituyente sólo en las plantas donde está disponible. */}
                        <div className="w-full mt-3">
                            <PlantasMaterialSection
                                value={plantasConfig}
                                onChange={setPlantasConfig}
                                tituloMaterial="este agregado"
                                hidePrecio
                            />
                        </div>

                        <div className="surface-100 border-round p-3 w-full mt-2">
                            <div className="flex align-items-center gap-2 text-sm text-600">
                                <i className="fa-solid fa-info-circle text-primary" />
                                <span>
                                    Los datos de densidad, absorción, módulo de finura, TMN, pasa tamiz #200
                                    y reactividad álcali-sílice (RAS) se obtienen automáticamente desde los
                                    ensayos cargados.
                                </span>
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

export default AgregadoForm;
