import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import { useToast } from "../../../../context/ToastContext";
import axios from "axios";
import { config } from "../../../../config/config";
import { Fade } from "react-awesome-reveal";

/* ═══════════════════════════════════════════════════════════════ */
/* utilidades helpers                                              */
/* ═══════════════════════════════════════════════════════════════ */
const emptyCem = () => ({ idCemento: null, cantidadCemento: null });
const emptyAdt = () => ({ idAditivo: null, cantidad: null });
const emptyAgreg = () => ({ idAgregado: null, cantidadAgregado: null });
const emptyFib = () => ({ idFibra: null, cantidadFibra: null });

const DosificacionForm = ({
    setDialogVisible,
    editDosificacion,
    reload,
    setReload,
}) => {
    const { id } = useParams() || {};
    const isEditing = Boolean(id || editDosificacion);
    const navigate = useNavigate();
    const showToast = useToast();

    /* ────────────  campos base  ──────────── */
    const [nombre, setNombre] = useState("");
    const [idTipoHormigon, setIdTipoHormigon] = useState(null);
    const [idEdadDisenio, setIdEdadDisenio] = useState(null);
    const [idAsentamientoDisenio, setIdAsentamientoDisenio] = useState(null);
    const [agua, setAgua] = useState(null);
    const [idTamanioMaximoNominal, setIdTamanioMaximoNominal] = useState(null);
    const [idTipoDescarga, setIdTipoDescarga] = useState(null);
    const [idPlanta, setIdPlanta] = useState(null);
    const [codigoEnPlanta, setCodigoEnPlanta] = useState("");
    const [descripcion, setDescripcion] = useState("");

    /* ────────────  materiales  ──────────── */
    const [cementos, setCementos] = useState([emptyCem()]);
    const [aditivos, setAditivos] = useState([]);
    const [agregados, setAgregados] = useState([]);
    const [fibras, setFibras] = useState([]);


    /* ────────────  catálogos  ──────────── */
    const [cat, setCat] = useState({
        tiposHormigon: [],
        edadesDisenio: [],
        asentamientosDisenio: [],
        tamaniosMaximos: [],
        tiposDescarga: [],
        plantas: [],
        cementos: [],
        aditivos: [],
        agregados: [],
        fibras: [],
    });

    /* ────────────  estados UI  ──────────── */
    const [saveLoading, setSaveLoading] = useState(false);
    const savingRef = useRef(false);
    const [errorMessage, setErrorMessage] = useState("");

    useEffect(() => {
        const fetchCatalogos = async () => {
            try {
                const [basicos, cem, adt, agr, fib] = await Promise.all([
                    axios.get(`${config.backendUrl}/api/dosificaciones/catalogos/basicos`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/cementos`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/aditivos`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/agregados`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/fibras`, { headers: config.headers }),
                ]);

                setCat({
                    ...basicos.data,
                    cementos: cem.data,
                    aditivos: adt.data,
                    agregados: agr.data,
                    fibras: fib.data,
                });
            } catch (err) {
                console.error(err);
                showToast("error", "No se pudieron cargar los catálogos");
            }
        };
        fetchCatalogos();
    }, []);


    useEffect(() => {
        if (editDosificacion) loadData(editDosificacion);
        else if (id) {
            axios
                .get(`${config.backendUrl}/api/dosificaciones/${id}`, { headers: config.headers })
                .then((res) => loadData(res.data))
                .catch((err) => {
                    console.error(err);
                    showToast("error", "No se pudieron cargar los datos de la dosificación");
                });
        }
    }, [editDosificacion, id]);

    const loadData = (d) => {
        setNombre(d.nombre || "");
        setIdTipoHormigon(d.idTipoHormigon);
        setIdEdadDisenio(d.idEdadDisenio);
        setIdAsentamientoDisenio(d.idAsentamientoDisenio);
        setAgua(d.agua);
        setIdTamanioMaximoNominal(d.idTamanioMaximoNominal);
        setIdTipoDescarga(d.idTipoDescarga);
        setIdPlanta(d.idPlanta);
        setCodigoEnPlanta(d.codigoEnPlanta || "");
        setDescripcion(d.descripcion || "");

        /* materiales */
        setCementos(d.cementos?.length ? d.cementos.map((c) => ({
            idCemento: c.idCemento,
            cantidadCemento: c.cantidadCemento,
        })) : [emptyCem()]);

        setAditivos(d.aditivos?.map((a) => ({
            idAditivo: a.idAditivo,
            cantidad: a.cantidad,
        })) || []);

        setAgregados(d.agregados?.map((ag) => ({
            idAgregado: ag.idAgregado,
            cantidadAgregado: ag.cantidadAgregado,
        })) || []);

        setFibras(d.fibras?.map((f) => ({
            idFibra: f.idFibra,
            cantidadFibra: f.cantidadFibra,
            unidadMedida: f.unidadMedida
        })) || []);
    };

    const handleCemChange = (idx, field, value) => {
        setCementos((prev) =>
            prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c))
        );
    };
    const addCemento = () =>
        cementos.length < 2 && setCementos((prev) => [...prev, emptyCem()]);
    const removeCemento = (idx) =>
        cementos.length > 1 &&
        setCementos((prev) => prev.filter((_, i) => i !== idx));

    const handleArrChange = (setter) => (idx, field, value) =>
        setter((prev) =>
            prev.map((o, i) => (i === idx ? { ...o, [field]: value } : o))
        );

    const addRow = (setter, empty) => () => setter((prev) => [...prev, empty()]);
    const removeRow = (setter, idx) => (e) => {
        e.preventDefault();
        setter((prev) => prev.filter((_, i) => i !== idx));
    };


    const validar = () => {
        if (!nombre.trim()) return "El nombre es obligatorio.";
        if (!idTipoHormigon) return "Tipo de hormigón requerido.";
        if (!idTamanioMaximoNominal) return "Debes seleccionar el TMN.";
        if (!idTipoDescarga) return "Debes seleccionar el tipo de descarga.";
        if (!idAsentamientoDisenio) return "Debes seleccionar un asentamiento.";
        if (!idEdadDisenio) return "Debes seleccionar la edad del diseño.";
        if (!agua) return "Indica la cantidad de agua.";
        if (!idPlanta) return "Debes seleccionar una planta.";

        if (!cementos.some((c) => c.idCemento && c.cantidadCemento))
            return "Agrega al menos un cemento con porcentaje.";

        if (!agregados.some((g) => g.idAgregado && g.cantidadAgregado))
            return "Agrega al menos un agregado con cantidad.";

        return "";
    };

    /* ═══════════════════════════════════════════════════════════════ */
    /* 5. guardar (POST/PUT)                                           */
    /* ═══════════════════════════════════════════════════════════════ */
    const guardar = async (e) => {
        e.preventDefault();
        if (savingRef.current) return;
        setErrorMessage("");
        const err = validar();
        if (err) return setErrorMessage(err);

        savingRef.current = true;
        setSaveLoading(true);
        const payload = {
            nombre,
            idTipoHormigon,
            idEdadDisenio,
            idAsentamientoDisenio,
            agua,
            idTamanioMaximoNominal,
            idTipoDescarga,
            idPlanta,
            codigoEnPlanta,
            descripcion,
            cementos: cementos.filter((c) => c.idCemento && c.cantidadCemento),
            aditivos: aditivos.filter((a) => a.idAditivo && a.cantidad),
            agregados: agregados.filter((g) => g.idAgregado && g.cantidadAgregado),
            fibras: fibras.filter((f) => f.idFibra && f.cantidadFibra),
        };

        try {
            if (isEditing) {
                const dosId = id || editDosificacion.idDosificacion;
                await axios.put(`${config.backendUrl}/api/dosificaciones/${dosId}`, payload, {
                    headers: config.headers,
                });
                showToast("success", "Dosificación actualizada con éxito");
            } else {
                await axios.post(`${config.backendUrl}/api/dosificaciones`, payload, {
                    headers: config.headers,
                });
                showToast("success", "Dosificación creada con éxito");
            }
            if (setReload) setReload(true);
            if (setDialogVisible) setDialogVisible(false);
            else navigate("/admin/dosificaciones");
        } catch (err) {
            console.error(err);
            const msg = err.response?.data?.error || "Error al guardar la dosificación";
            showToast("error", msg);
        } finally {
            savingRef.current = false;
            setSaveLoading(false);
        }
    };

    const mapOpt = (arr, label, value) =>
        arr.map((o) => ({ label: o[label], value: o[value] }));

    return (
        <Fade direction="up" duration={500} triggerOnce>
            <div className="flex w-full justify-content-center">
                <div className="p-0 py-4 xl:p-3 xl:pt-5 flex flex-column align-items-center w-full xl:w-10">
                    {/* header */}
                    <div className="form-card-header w-full flex justify-content-between align-items-center">
                        <div>
                            <i className="fa-solid fa-flask-vial mr-2"></i>
                            {isEditing ? "Editar dosificación" : "Nueva dosificación"}
                        </div>
                        <i
                            className="fa-solid fa-circle-arrow-left cursor-pointer hover-red"
                            style={{ fontSize: "1.2rem" }}
                            onClick={() => navigate("/admin/dosificaciones")}
                        ></i>
                    </div>

                    {/* formulario */}
                    <form
                        className="w-full flex flex-column align-items-center form-card pt-5 pb-5"
                        onSubmit={guardar}
                    >
                        <div className="w-11 xl:w-9">
                            {/* fila 1 */}
                            <div className="flex flex-column xl:flex-row gap-3 w-full">
                                <div className="flex flex-column mb-2 w-full xl:w-6">
                                    <small>
                                        <small className="color-danger">* </small>Nombre
                                    </small>
                                    <InputText value={nombre} onChange={(e) => setNombre(e.target.value)} />
                                </div>
                                <div className="flex flex-column mb-2 w-full xl:w-6">
                                    <small>
                                        <small className="color-danger">* </small>Tipo Hormigón
                                    </small>
                                    <Dropdown
                                        value={idTipoHormigon}
                                        onChange={(e) => setIdTipoHormigon(e.value)}
                                        options={mapOpt(cat.tiposHormigon, "tipoHormigon", "idTipoHormigon")}
                                        placeholder="Ej: H30"
                                        className="w-full"
                                    />
                                </div>
                            </div>

                            {/* fila 2 */}
                            <div className="flex flex-column xl:flex-row gap-3 w-full">
                                <div className="flex flex-column mb-2 w-full xl:w-4">
                                    <small><small className="color-danger">* </small>Edad diseño (días)</small>
                                    <Dropdown
                                        value={idEdadDisenio}
                                        onChange={(e) => setIdEdadDisenio(e.value)}
                                        options={mapOpt(cat.edadesDisenio, "dias", "idEdadDisenio")}
                                        className="w-full"
                                    />
                                </div>
                                <div className="flex flex-column mb-2 w-full xl:w-4">
                                    <small><small className="color-danger">* </small>Asentamiento (cm)</small>
                                    <Dropdown
                                        value={idAsentamientoDisenio}
                                        onChange={(e) => setIdAsentamientoDisenio(e.value)}
                                        options={mapOpt(cat.asentamientosDisenio, "asentamiento", "idAsentamientoDisenio")}
                                        className="w-full"
                                    />
                                </div>
                                <div className="flex flex-column mb-2 w-full xl:w-4">
                                    <small>
                                        <small className="color-danger">* </small>Agua (L)
                                    </small>
                                    <InputNumber
                                        value={agua}
                                        onChange={(e) => setAgua(e.value)}
                                        mode="decimal"
                                    />
                                </div>
                            </div>

                            {/* fila 3 */}
                            <div className="flex flex-column xl:flex-row gap-3 w-full">
                                <div className="flex flex-column mb-2 w-full xl:w-4">
                                    <small><small className="color-danger">* </small>TMN (mm)</small>
                                    <Dropdown
                                        value={idTamanioMaximoNominal}
                                        onChange={(e) => setIdTamanioMaximoNominal(e.value)}
                                        options={mapOpt(cat.tamaniosMaximos, "tamanio", "idTamanioMaximoNominal")}
                                        className="w-full"
                                    />
                                </div>
                                <div className="flex flex-column mb-2 w-full xl:w-4">
                                    <small><small className="color-danger">* </small>Tipo descarga</small>
                                    <Dropdown
                                        value={idTipoDescarga}
                                        onChange={(e) => setIdTipoDescarga(e.value)}
                                        options={mapOpt(cat.tiposDescarga, "tipo", "idTipoDescarga")}
                                        className="w-full"
                                    />
                                </div>
                                <div className="flex flex-column mb-2 w-full xl:w-4">
                                    <small>
                                        <small className="color-danger">* </small>Planta
                                    </small>
                                    <Dropdown
                                        value={idPlanta}
                                        onChange={(e) => setIdPlanta(e.value)}
                                        options={mapOpt(cat.plantas, "nombre", "idPlanta")}
                                        className="w-full"
                                    />
                                </div>
                            </div>

                            {/* fila 4 */}
                            <div className="flex flex-column xl:flex-row gap-3 w-full">
                                <div className="flex flex-column mb-2 w-full xl:w-4">
                                    <small>Código en planta</small>
                                    <InputText value={codigoEnPlanta} onChange={(e) => setCodigoEnPlanta(e.target.value)} />
                                </div>
                                <div className="flex flex-column mb-2 w-full xl:w-8">
                                    <small>Descripción</small>
                                    <InputText value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
                                </div>
                            </div>


                            <div className="w-full pt-0 mt-3">
                                {/* ══════ Cementos ══════ */}
                                <div className="w-full">
                                    <div className="form-card-header align-items-center w-full">
                                        <span className="mr-2">Cementos</span>

                                        {cementos.length < 2 && (
                                            <i className="fa-solid fa-plus hover-green" onClick={addCemento} />
                                        )}
                                    </div>

                                    <div className="dosif-comp p-3 pr-0">
                                        {cementos.map((c, idx) => {
                                            return (
                                                <div key={idx} className="flex flex-column xl:flex-row gap-3 mb-2">
                                                    <Dropdown
                                                        value={c.idCemento}
                                                        onChange={(e) => handleCemChange(idx, "idCemento", e.value)}
                                                        options={cat.cementos.map((cem) => ({
                                                            label: cem.nombreComercial,
                                                            value: cem.idCemento,
                                                        }))}
                                                        placeholder="Cemento"
                                                        className="w-full xl:w-8"
                                                    />
                                                    <InputNumber
                                                        value={c.cantidadCemento}
                                                        onChange={(e) =>
                                                            handleCemChange(idx, "cantidadCemento", e.value)
                                                        }
                                                        suffix={` kg`}
                                                        className="w-full xl:w-2"
                                                        inputClassName="w-full"
                                                    />
                                                    {cementos.length > 1 && (
                                                        <Button
                                                            icon="fa-solid fa-minus"
                                                            rounded
                                                            text
                                                            severity="danger"
                                                            onClick={() => removeCemento(idx)}
                                                        />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* ══════ Aditivos ══════ */}
                                <div className="w-full mt-4">
                                    <div className="form-card-header align-items-center w-full">
                                        <span className="mr-2">Aditivos</span>
                                        <i className="fa-solid fa-plus hover-green" onClick={addRow(setAditivos, emptyAdt)} />
                                    </div>

                                    <div className="dosif-comp p-3 pr-0">
                                        {aditivos.length === 0 && <span className="font-medium">No hay aditivos agregados</span>}

                                        {aditivos.map((a, idx) => {
                                            const unidad =
                                                cat.aditivos.find((ad) => ad.idAditivo === a.idAditivo)
                                                    ?.unidadMedida?.unidad || "";

                                            return (
                                                <div key={idx} className="flex flex-column xl:flex-row gap-3 mb-2">
                                                    <Dropdown
                                                        value={a.idAditivo}
                                                        onChange={(e) => handleArrChange(setAditivos)(idx, "idAditivo", e.value)}
                                                        options={cat.aditivos.map((ad) => ({
                                                            label: ad.marca,
                                                            value: ad.idAditivo,
                                                        }))}
                                                        placeholder="Aditivo"
                                                        className="w-full xl:w-8"
                                                    />
                                                    <InputNumber
                                                        value={a.cantidad}
                                                        onChange={(e) => handleArrChange(setAditivos)(idx, "cantidad", e.value)}
                                                        suffix={` ${unidad}`}
                                                        className="w-full xl:w-2"
                                                        inputClassName="w-full"
                                                    />
                                                    <Button
                                                        type="button"
                                                        icon="fa-solid fa-minus"
                                                        rounded
                                                        text
                                                        severity="danger"
                                                        onClick={removeRow(setAditivos, idx)}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* ══════ Agregados ══════ */}
                                <div className="w-full mt-4">
                                    <div className="form-card-header align-items-center w-full">
                                        <span className="mr-2">Agregados</span>
                                        <i className="fa-solid fa-plus hover-green" onClick={addRow(setAgregados, emptyAgreg)} />
                                    </div>

                                    <div className="dosif-comp p-3 pr-0">
                                        {agregados.length === 0 && <span className="font-medium">No hay agregados</span>}

                                        {agregados.map((g, idx) => {
                                            const unidad =
                                                cat.agregados.find((ag) => ag.idAgregado === g.idAgregado)
                                                    ?.unidadMedida?.unidad || "";

                                            return (
                                                <div key={idx} className="flex flex-column xl:flex-row gap-3 mb-2">
                                                    <Dropdown
                                                        value={g.idAgregado}
                                                        onChange={(e) => handleArrChange(setAgregados)(idx, "idAgregado", e.value)}
                                                        options={cat.agregados.map((ag) => ({
                                                            label: ag.nombre,
                                                            value: ag.idAgregado,
                                                        }))}
                                                        placeholder="Agregado"
                                                        className="w-full xl:w-8"
                                                    />
                                                    <InputNumber
                                                        value={g.cantidadAgregado}
                                                        onChange={(e) =>
                                                            handleArrChange(setAgregados)(idx, "cantidadAgregado", e.value)
                                                        }
                                                        suffix={` ${unidad}`}
                                                        className="w-full xl:w-2"
                                                        inputClassName="w-full"
                                                    />
                                                    <Button
                                                        type="button"
                                                        icon="fa-solid fa-minus"
                                                        rounded
                                                        text
                                                        severity="danger"
                                                        onClick={removeRow(setAgregados, idx)}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* ══════ Fibras ══════ */}
                                <div className="w-full mt-4">
                                    <div className="form-card-header align-items-center w-full">
                                        <span className="mr-2">Fibras</span>
                                        <i
                                            className="fa-solid fa-plus hover-green"
                                            onClick={addRow(setFibras, emptyFib)}
                                        />
                                    </div>

                                    <div className="dosif-comp p-3 pr-0">
                                        {fibras.length === 0 && (
                                            <span className="font-medium">No hay fibras agregadas</span>
                                        )}

                                        {fibras.map((f, idx) => {
                                            const unidad =
                                                cat.fibras.find((fi) => fi.idFibra === f.idFibra)?.unidadMedida?.unidad || "";

                                            return (

                                                <div key={idx} className="flex flex-column xl:flex-row gap-3 mb-2">
                                                    <Dropdown
                                                        value={f.idFibra}
                                                        onChange={(e) =>
                                                            handleArrChange(setFibras)(idx, "idFibra", e.value)
                                                        }
                                                        options={cat.fibras.map((fi) => ({
                                                            label: fi.marca,
                                                            value: fi.idFibra,
                                                        }))}
                                                        placeholder="Fibra"
                                                        className="w-full xl:w-8"
                                                    />
                                                    <InputNumber
                                                        value={f.cantidadFibra}
                                                        onChange={(e) =>
                                                            handleArrChange(setFibras)(idx, "cantidadFibra", e.value)
                                                        }
                                                        suffix={` ${unidad}`}
                                                        className="w-full xl:w-2"
                                                        inputClassName="w-full"
                                                    />
                                                    <Button
                                                        type="button"
                                                        icon="fa-solid fa-minus"
                                                        rounded
                                                        text
                                                        severity="danger"
                                                        onClick={removeRow(setFibras, idx)}
                                                    />
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                            {/* errores */}
                            {errorMessage && (
                                <small className="error-msg flex align-items-center mt-3">
                                    <i className="fa-regular fa-circle-xmark mr-2"></i>
                                    {errorMessage}
                                </small>
                            )}

                            {/* botones */}
                            <div className="flex justify-content-center mt-4 w-full">
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
                        </div>

                    </form>
                </div>
            </div>
        </Fade>
    );
};

export default DosificacionForm;
