import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { MultiSelect } from "primereact/multiselect";
import { Button } from "primereact/button";
import { Divider } from "primereact/divider";
import { Message } from "primereact/message";
import { useToast } from "../../../../context/ToastContext";
import axios from "axios";
import { config } from "../../../../config/config";
import { Fade } from "react-awesome-reveal";
import FormField from "../../../common/FormField";

const MODOS_CURVA = [
    { label: 'Referencia general (genérica por familia)', value: 'ICPA' },
    { label: 'Curva del fabricante', value: 'FABRICANTE' },
    { label: 'Curva propia (experiencia)', value: 'PROPIA' },
];

const OPCIONES_COMPOSICION = [
  { label: "CPN (Normal)", value: "CPN" },
  { label: "CPF (con filler)", value: "CPF" },
  { label: "CPC (compuesto)", value: "CPC" },
  { label: "CPP (puzolánico)", value: "CPP" },
  { label: "CPE (con escoria)", value: "CPE" },
  { label: "CAH (alto horno)", value: "CAH" },
];

const OPCIONES_RESISTENCIA = [
  { label: "30", value: 30 },
  { label: "40", value: 40 },
  { label: "50", value: 50 },
];

const OPCIONES_PROPIEDADES = [
  { label: "ARI (Alta Resistencia Inicial)", value: "ARI" },
  { label: "ARS (Altamente Resistente a Sulfatos)", value: "ARS" },
  { label: "MRS (Moderadamente Resistente a Sulfatos)", value: "MRS" },
  { label: "BCH (Bajo Calor de Hidratación)", value: "BCH" },
  { label: "RRAA (Resistente Reacción Álcali-Agregado)", value: "RRAA" },
  { label: "B (Blanco)", value: "B" },
];

const OPCIONES_FAMILIA = [
  { label: "CP30", value: "CP30" },
  { label: "CP40", value: "CP40" },
  { label: "CP50", value: "CP50" },
];

const OPCIONES_DESARROLLO = [
  { label: "Rápido (ARI)", value: "RAPIDO" },
  { label: "Normal", value: "NORMAL" },
  { label: "Lento", value: "LENTO" },
];

const CementoForm = ({ setDialogVisible, editCemento, reload, setReload }) => {
    const { id } = useParams() || {};
    const navigate = useNavigate();
    const isEditing = Boolean(id || editCemento);
    const cementoIdActual = id || editCemento?.idCemento || null;

    /* ── Identificación ── */
    const [nombreComercial, setNombreComercial] = useState("");
    const [fabricante, setFabricante] = useState("");
    const [origenFabrica, setOrigenFabrica] = useState("");

    /* ── Clasificación técnica ── */
    const [composicion, setComposicion] = useState(null);
    const [resistencia, setResistencia] = useState(null);
    const [propiedades, setPropiedades] = useState([]);
    const [tipoNormativo, setTipoNormativo] = useState("");
    const [familiaCemento, setFamiliaCemento] = useState(null);
    const [desarrolloResistencia, setDesarrolloResistencia] = useState(null);

    /* ── Propiedades para cálculo ── */
    const [densidadRelativa, setDensidadRelativa] = useState(null);
    const [edadReferenciaDefault, setEdadReferenciaDefault] = useState(28);

    /* ── Disponibilidad por planta + curvas ── */
    const [plantasDisponibles, setPlantasDisponibles] = useState([]);
    const [curvasFabricante, setCurvasFabricante] = useState([]); // global (idPlanta=null)
    const [curvasPropiasPorPlanta, setCurvasPropiasPorPlanta] = useState({}); // { idPlanta: [curvas] }
    const [plantasConfig, setPlantasConfig] = useState([]); // [{ idPlanta, nombrePlanta, modoCurva, factorAjuste, idCurvaPropia, activo, idCementoPlanta?, precio?, unidadPrecio?, fechaVigencia? }]

    /* ── Opcionales ── */
    const [observaciones, setObservaciones] = useState("");

    const [saveLoading, setSaveLoading] = useState(false);
    const savingRef = useRef(false);
    const [errorMessage, setErrorMessage] = useState("");

    const showToast = useToast();

    useEffect(() => {
        // Cargar plantas y curvas globales del fabricante en paralelo
        (async () => {
            try {
                const [plRes, cvRes] = await Promise.all([
                    axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/curvas-cemento`, { headers: config.headers }),
                ]);
                setPlantasDisponibles(plRes.data || []);
                const curvas = cvRes.data || [];
                setCurvasFabricante(curvas.filter(c => c.idPlanta == null));
                // index curvas por planta
                const idx = {};
                for (const c of curvas) {
                    if (c.idPlanta != null) {
                        if (!idx[c.idPlanta]) idx[c.idPlanta] = [];
                        idx[c.idPlanta].push(c);
                    }
                }
                setCurvasPropiasPorPlanta(idx);
            } catch {
                showToast("error", "No se pudieron cargar plantas o curvas.");
            }
        })();

        if (editCemento) {
            loadData(editCemento);
        } else if (id) {
            axios
                .get(`${config.backendUrl}/api/cementos/${id}`, { headers: config.headers })
                .then((res) => loadData(res.data))
                .catch(() => showToast("error", "No se pudieron cargar los datos del cemento"));
        }
    }, [editCemento, id]); // eslint-disable-line react-hooks/exhaustive-deps

    const loadData = (cem) => {
        setNombreComercial(cem.nombreComercial || "");
        setFabricante(cem.fabricante || "");
        setOrigenFabrica(cem.origenFabrica || "");
        setComposicion(cem.composicion || null);
        setResistencia(cem.resistencia || null);
        setPropiedades(cem.propiedades ? cem.propiedades.split(",").map(p => p.trim()) : []);
        setTipoNormativo(cem.tipoNormativo || "");
        setFamiliaCemento(cem.familiaCemento || null);
        setDesarrolloResistencia(cem.desarrolloResistencia || null);
        setDensidadRelativa(cem.densidadRelativa != null ? Number(cem.densidadRelativa) : null);
        setEdadReferenciaDefault(cem.edadReferenciaDefault || 28);
        setObservaciones(cem.observaciones || "");
        // Configuración por planta (proviene del backend en cem.configuracionPorPlanta)
        const configs = Array.isArray(cem.configuracionPorPlanta) ? cem.configuracionPorPlanta : [];
        setPlantasConfig(configs.map(c => ({
            idCementoPlanta: c.idCementoPlanta,
            idPlanta: c.idPlanta,
            nombrePlanta: c.planta?.nombre || `Planta ${c.idPlanta}`,
            modoCurva: c.modoCurva || 'ICPA',
            factorAjuste: c.factorAjuste != null ? Number(c.factorAjuste) : 1.000,
            idCurvaPropia: c.idCurvaPropia || null,
            activo: c.activo !== false,
            precioActual: c.precioVigente?.precioUnitario != null ? Number(c.precioVigente.precioUnitario) : null,
            unidadPrecio: c.precioVigente?.unidad || 'kg',
            // Si el usuario ingresa un precio nuevo, lo guardamos aparte
            nuevoPrecio: null,
        })));
    };

    const validar = () => {
        if (!nombreComercial?.trim()) return "El nombre comercial es obligatorio.";
        if (!fabricante?.trim()) return "El fabricante es obligatorio.";
        if (!composicion) return "Falta elegir la composición.";
        if (!resistencia) return "Falta elegir la resistencia.";
        return "";
    };

    /* Indica si el cemento está listo para dosificación */
    const aptoParaDosificacion = densidadRelativa > 0;

    const buildPayload = () => ({
        nombreComercial,
        fabricante,
        origenFabrica,
        composicion,
        resistencia,
        propiedades: (propiedades || []).join(","),
        tipoNormativo: tipoNormativo || null,
        familiaCemento,
        desarrolloResistencia,
        densidadRelativa,
        edadReferenciaDefault,
        observaciones: observaciones || null,
        plantasConfig: plantasConfig.map(c => ({
            idCementoPlanta: c.idCementoPlanta,
            idPlanta: c.idPlanta,
            modoCurva: c.modoCurva,
            factorAjuste: c.factorAjuste,
            idCurvaPropia: c.modoCurva === 'PROPIA' ? c.idCurvaPropia : null,
            activo: c.activo !== false,
        })),
    });

    const guardarCemento = async (e) => {
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

        // Validación local de coherencia: PROPIA requiere idCurvaPropia
        for (const cfg of plantasConfig) {
            if (cfg.modoCurva === 'PROPIA' && !cfg.idCurvaPropia) {
                setErrorMessage(`En la planta "${cfg.nombrePlanta}" elegiste "Curva propia" pero no asignaste ninguna curva.`);
                savingRef.current = false;
                setSaveLoading(false);
                return;
            }
        }

        try {
            let cementoIdGuardado = id || editCemento?.idCemento;
            if (isEditing) {
                await axios.put(`${config.backendUrl}/api/cementos/${cementoIdGuardado}`, buildPayload(), { headers: config.headers });
                showToast("success", "Cemento actualizado con éxito");
            } else {
                const r = await axios.post(`${config.backendUrl}/api/cementos`, buildPayload(), { headers: config.headers });
                cementoIdGuardado = r.data?.idCemento || r.data?.id;
                showToast("success", "Cemento creado con éxito");
            }

            // Registrar precios nuevos por planta (si el usuario los ingresó)
            const hoy = new Date().toISOString().slice(0, 10);
            for (const cfg of plantasConfig) {
                if (cfg.nuevoPrecio != null && cfg.nuevoPrecio !== '' && Number(cfg.nuevoPrecio) > 0) {
                    try {
                        await axios.post(`${config.backendUrl}/api/material-precios`, {
                            materialSource: 'cemento',
                            materialSourceId: cementoIdGuardado,
                            idPlanta: cfg.idPlanta,
                            precioUnitario: Number(cfg.nuevoPrecio),
                            unidad: cfg.unidadPrecio || 'kg',
                            fechaVigencia: hoy,
                            autoVencer: true,
                        }, { headers: config.headers });
                    } catch (errP) {
                        console.warn('No se pudo guardar precio para planta', cfg.idPlanta, errP.message);
                    }
                }
            }

            if (setReload) setReload(true);
            if (setDialogVisible) setDialogVisible(false);
            else window.history.back();
        } catch (err) {
            console.error(err);
            showToast("error", err.response?.data?.error || "Error al guardar el cemento");
        } finally {
            savingRef.current = false;
            setSaveLoading(false);
        }
    };

    /* ─── Helpers para gestión de la configuración por planta ─── */
    const updatePlantaCfg = (idPlanta, patch) => {
        setPlantasConfig(prev => prev.map(c => c.idPlanta === idPlanta ? { ...c, ...patch } : c));
    };

    const agregarPlanta = (idPlanta) => {
        if (plantasConfig.some(c => c.idPlanta === idPlanta && c.activo)) return;
        const planta = plantasDisponibles.find(p => p.idPlanta === idPlanta);
        if (!planta) return;
        // Si ya existe inactivo, lo reactivamos
        const existing = plantasConfig.find(c => c.idPlanta === idPlanta);
        if (existing) {
            updatePlantaCfg(idPlanta, { activo: true });
            return;
        }
        setPlantasConfig(prev => [...prev, {
            idPlanta,
            nombrePlanta: planta.nombre,
            modoCurva: 'ICPA',
            factorAjuste: 1.000,
            idCurvaPropia: null,
            activo: true,
            precioActual: null,
            unidadPrecio: 'kg',
            nuevoPrecio: null,
        }]);
    };

    const desasignarPlanta = (idPlanta) => {
        updatePlantaCfg(idPlanta, { activo: false });
    };

    const plantasAsignadas = plantasConfig.filter(c => c.activo);
    const plantasNoAsignadas = plantasDisponibles.filter(p => !plantasAsignadas.some(c => c.idPlanta === p.idPlanta));

    return (
        <Fade direction="up" duration={500} triggerOnce>
            <div className="flex w-full justify-content-center">
                <div className="p-0 py-4 xl:p-3 xl:pt-5 flex flex-column align-items-center w-full xl:w-9">
                    <div className="form-card-header w-full flex justify-content-between align-items-center">
                        <div>
                            <i className="fa-solid fa-industry mr-2" />
                            {isEditing ? "Editar cemento" : "Nuevo cemento"}
                        </div>
                        <i
                            className="fa-solid fa-circle-arrow-left cursor-pointer hover-red"
                            style={{ fontSize: "1.2rem" }}
                            onClick={() => window.history.back()}
                        />
                    </div>

                    <form className="w-full flex flex-column align-items-center form-card pt-4 pb-5" onSubmit={guardarCemento}>
                        <div className="w-full">

                            {/* ── SECCIÓN: Identificación ── */}
                            <h4 className="mt-0 mb-2"><i className="fa-solid fa-tag mr-2 text-primary" />Identificación</h4>
                            <div className="grid">
                                <FormField className="col-12 md:col-6" label="Nombre comercial" required>
                                    <InputText value={nombreComercial} onChange={(e) => setNombreComercial(e.target.value)} className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Fabricante" required>
                                    <InputText value={fabricante} onChange={(e) => setFabricante(e.target.value)} className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Origen de la fábrica">
                                    <InputText value={origenFabrica} onChange={(e) => setOrigenFabrica(e.target.value)} className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Tipo normativo (ej: CPN 40 ARI)">
                                    <InputText value={tipoNormativo} onChange={(e) => setTipoNormativo(e.target.value)} placeholder="Ej: CPN 40 ARI" className="w-full" />
                                </FormField>
                            </div>

                            <Divider className="my-3" />

                            {/* ── SECCIÓN: Clasificación técnica ── */}
                            <h4 className="mt-0 mb-2"><i className="fa-solid fa-flask mr-2 text-primary" />Clasificación técnica</h4>
                            <div className="grid">
                                <FormField label="Composición" required>
                                    <Dropdown value={composicion} onChange={(e) => setComposicion(e.value)} options={OPCIONES_COMPOSICION} placeholder="CPN, CPF..." className="w-full" />
                                </FormField>
                                <FormField label="Resistencia" required>
                                    <Dropdown value={resistencia} onChange={(e) => setResistencia(e.value)} options={OPCIONES_RESISTENCIA} placeholder="30, 40, 50" className="w-full" />
                                </FormField>
                                <FormField label="Familia cemento (curvas a/c)">
                                    <Dropdown value={familiaCemento} onChange={(e) => setFamiliaCemento(e.value)} options={OPCIONES_FAMILIA} placeholder="CP30, CP40, CP50" className="w-full" showClear />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Propiedades especiales">
                                    <MultiSelect value={propiedades} onChange={(e) => setPropiedades(e.value)} options={OPCIONES_PROPIEDADES} placeholder="ARI, ARS..." display="chip" className="w-full" />
                                </FormField>
                                <FormField className="col-12 md:col-6" label="Desarrollo de resistencia">
                                    <Dropdown value={desarrolloResistencia} onChange={(e) => setDesarrolloResistencia(e.value)} options={OPCIONES_DESARROLLO} placeholder="Normal" className="w-full" showClear />
                                </FormField>
                            </div>

                            <Divider className="my-3" />

                            {/* ── SECCIÓN: Propiedades para cálculo ── */}
                            <h4 className="mt-0 mb-2"><i className="fa-solid fa-calculator mr-2 text-primary" />Propiedades para cálculo</h4>
                            {!aptoParaDosificacion && (
                                <Message severity="warn" text="Este cemento no tiene densidad real cargada y no podrá usarse en el motor de dosificación." className="mb-3 w-full" />
                            )}
                            <div className="grid">
                                <FormField label="Densidad real (g/cm³)">
                                    <InputNumber value={densidadRelativa} onValueChange={(e) => setDensidadRelativa(e.value)} min={2} max={4} minFractionDigits={2} maxFractionDigits={3} placeholder="Ej: 3.15" className="w-full" inputClassName="w-full" />
                                </FormField>
                                <FormField label="Edad referencia (días)">
                                    <InputNumber value={edadReferenciaDefault} onValueChange={(e) => setEdadReferenciaDefault(e.value)} min={1} max={365} placeholder="28" className="w-full" inputClassName="w-full" />
                                </FormField>
                            </div>

                            <Divider className="my-3" />

                            {/* ── SECCIÓN: Disponibilidad y curvas por planta ── */}
                            <h4 className="mt-0 mb-2"><i className="fa-solid fa-industry mr-2 text-primary" />Disponibilidad y curvas por planta</h4>
                            <p className="text-sm text-color-secondary mt-0 mb-3">
                                Cada planta puede usar una curva distinta y un factor de ajuste propio para reflejar su realidad operativa.
                                El factor 1.000 significa "sin efecto" sobre la curva elegida.
                            </p>

                            {plantasAsignadas.length === 0 && (
                                <Message severity="warn" text="Este cemento no está asignado a ninguna planta. No podrá usarse en dosificaciones hasta que asignes al menos una." className="mb-3 w-full" />
                            )}

                            {plantasAsignadas.map(cfg => {
                                const esPropia = cfg.modoCurva === 'PROPIA';
                                // Curvas del fabricante para este cemento (idPlanta=null + cementoId match o fabricante match)
                                const curvasFabricanteParaEsteCemento = curvasFabricante.filter(c =>
                                    c.activo !== false && (
                                        (cementoIdActual && c.cementoId && Number(c.cementoId) === Number(cementoIdActual)) ||
                                        (familiaCemento && c.familiaCemento === familiaCemento && !c.cementoId)
                                    )
                                );
                                // Curvas propias para este cemento + planta (compatibles)
                                const curvasPropiasParaEstaPlantaYCemento = (curvasPropiasPorPlanta[cfg.idPlanta] || []).filter(c =>
                                    c.activo !== false && (
                                        (cementoIdActual && c.cementoId && Number(c.cementoId) === Number(cementoIdActual)) ||
                                        (!c.cementoId && (!c.familiaCemento || c.familiaCemento === familiaCemento))
                                    )
                                );
                                // Resolución de la curva referenciada según el modo
                                let curvaResolvedLabel, curvaResolvedSeverity;
                                if (cfg.modoCurva === 'ICPA') {
                                    if (familiaCemento) {
                                        curvaResolvedLabel = `→ Se usará: Referencia general - ${familiaCemento}`;
                                        curvaResolvedSeverity = 'info';
                                    } else {
                                        curvaResolvedLabel = `⚠ Falta familia de cemento (CP30/CP40/CP50). Sin familia, la curva de referencia no puede aplicar.`;
                                        curvaResolvedSeverity = 'warn';
                                    }
                                } else if (cfg.modoCurva === 'FABRICANTE') {
                                    if (curvasFabricanteParaEsteCemento.length > 0) {
                                        const c = curvasFabricanteParaEsteCemento[0];
                                        curvaResolvedLabel = `→ Se usará: ${c.nombre}${c.anioVigencia ? ` (${c.anioVigencia})` : ''}`;
                                        curvaResolvedSeverity = 'info';
                                    } else {
                                        curvaResolvedLabel = `⚠ Sin curva del fabricante cargada para este cemento. Cargá una desde Curvas de cemento.`;
                                        curvaResolvedSeverity = 'warn';
                                    }
                                }
                                // Modo PROPIA: la curva se elige explícitamente abajo, no se resuelve
                                const navegarACurvas = (extraParams = {}) => {
                                    const params = new URLSearchParams();
                                    if (cementoIdActual) params.set('cementoId', cementoIdActual);
                                    params.set('idPlanta', cfg.idPlanta);
                                    Object.entries(extraParams).forEach(([k, v]) => params.set(k, v));
                                    navigate(`/calidad/catalogos/curvas-cemento?${params.toString()}`);
                                };
                                return (
                                <div key={cfg.idPlanta} className="surface-card border-1 surface-border border-round p-3 mb-3">
                                    <div className="flex justify-content-between align-items-center mb-2">
                                        <div className="font-bold">
                                            <i className="fa-solid fa-location-dot mr-2 text-primary" />
                                            {cfg.nombrePlanta}
                                        </div>
                                        <Button
                                            type="button"
                                            label="Quitar"
                                            severity="danger"
                                            text
                                            size="small"
                                            icon="fa-solid fa-xmark"
                                            onClick={() => desasignarPlanta(cfg.idPlanta)}
                                        />
                                    </div>
                                    <div className="grid">
                                        <div className={`col-12 sm:col-6 ${esPropia ? 'md:col-5' : 'md:col-7'} flex flex-column mb-2`}>
                                            <small>Modo de curva</small>
                                            <Dropdown
                                                value={cfg.modoCurva}
                                                onChange={(e) => updatePlantaCfg(cfg.idPlanta, { modoCurva: e.value, idCurvaPropia: e.value === 'PROPIA' ? cfg.idCurvaPropia : null })}
                                                options={MODOS_CURVA}
                                                className="w-full"
                                            />
                                            {curvaResolvedLabel && (
                                                <small className={`mt-1 ${curvaResolvedSeverity === 'warn' ? 'text-orange-400' : 'text-color-secondary'}`}>
                                                    {curvaResolvedLabel}
                                                </small>
                                            )}
                                            {cfg.modoCurva === 'FABRICANTE' && curvasFabricanteParaEsteCemento.length === 0 && (
                                                <Button
                                                    type="button"
                                                    label="Cargar curva del fabricante"
                                                    icon="fa-solid fa-plus"
                                                    text
                                                    size="small"
                                                    className="mt-1 align-self-start"
                                                    onClick={() => navegarACurvas({ origenCurva: 'FABRICANTE', ambito: 'GLOBAL' })}
                                                />
                                            )}
                                        </div>
                                        <div className={`col-12 sm:col-6 ${esPropia ? 'md:col-2' : 'md:col-5'} flex flex-column mb-2`}>
                                            <small>Factor de ajuste</small>
                                            <InputNumber
                                                value={cfg.factorAjuste}
                                                onValueChange={(e) => updatePlantaCfg(cfg.idPlanta, { factorAjuste: e.value })}
                                                min={0.500} max={2.000} step={0.005}
                                                minFractionDigits={3} maxFractionDigits={3}
                                                placeholder="1.000"
                                                className="w-full"
                                                inputClassName="w-full"
                                            />
                                            <small className="text-color-secondary mt-1">
                                                {cfg.factorAjuste > 1.001 ? `Rinde ${((cfg.factorAjuste - 1) * 100).toFixed(1)}% más → menos cemento`
                                                : cfg.factorAjuste < 0.999 ? `Rinde ${((1 - cfg.factorAjuste) * 100).toFixed(1)}% menos → más cemento`
                                                : 'Sin efecto (1.000)'}
                                            </small>
                                        </div>
                                        {esPropia && (
                                            <div className="col-12 md:col-5 flex flex-column mb-2">
                                                <small>Curva propia</small>
                                                <Dropdown
                                                    value={cfg.idCurvaPropia}
                                                    onChange={(e) => updatePlantaCfg(cfg.idPlanta, { idCurvaPropia: e.value })}
                                                    options={curvasPropiasParaEstaPlantaYCemento.map(c => ({
                                                        label: `${c.nombre}${c.anioVigencia ? ` (${c.anioVigencia})` : ''}`,
                                                        value: c.id,
                                                    }))}
                                                    placeholder={curvasPropiasParaEstaPlantaYCemento.length === 0 ? "(no hay curvas propias)" : "(seleccionar)"}
                                                    showClear
                                                    emptyMessage="No hay curvas propias compatibles para este cemento + planta"
                                                    className="w-full"
                                                />
                                                <Button
                                                    type="button"
                                                    label={curvasPropiasParaEstaPlantaYCemento.length === 0 ? "Cargar curva propia" : "Agregar otra curva propia"}
                                                    icon="fa-solid fa-plus"
                                                    text
                                                    size="small"
                                                    className="mt-1 align-self-start"
                                                    onClick={() => navegarACurvas({ origenCurva: 'PROPIA' })}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <Divider className="my-2" />
                                    <div className="grid">
                                        <FormField className="col-12 sm:col-6 md:col-4" label={`Precio actual (${cfg.unidadPrecio || 'kg'})`}>
                                            <InputText
                                                value={cfg.precioActual != null ? `$ ${Number(cfg.precioActual).toLocaleString('es-AR')}` : '— sin precio cargado —'}
                                                disabled
                                                className="w-full"
                                            />
                                        </FormField>
                                        <FormField className="col-12 sm:col-6 md:col-4" label="Nuevo precio (opcional)">
                                            <InputNumber
                                                value={cfg.nuevoPrecio}
                                                onValueChange={(e) => updatePlantaCfg(cfg.idPlanta, { nuevoPrecio: e.value })}
                                                mode="currency" currency="ARS" locale="es-AR"
                                                placeholder="Ingresar para actualizar"
                                                className="w-full"
                                                inputClassName="w-full"
                                            />
                                        </FormField>
                                        <FormField className="col-12 md:col-4" label="Unidad">
                                            <Dropdown
                                                value={cfg.unidadPrecio}
                                                onChange={(e) => updatePlantaCfg(cfg.idPlanta, { unidadPrecio: e.value })}
                                                options={[
                                                    { label: 'Kilogramo', value: 'kg' },
                                                    { label: 'Tonelada', value: 'ton' },
                                                    { label: 'Bolsa', value: 'bolsa' },
                                                ]}
                                                className="w-full"
                                            />
                                        </FormField>
                                    </div>
                                </div>
                                );
                            })}

                            {plantasNoAsignadas.length > 0 && (
                                <div className="flex align-items-center gap-2 mb-2">
                                    <Dropdown
                                        value={null}
                                        onChange={(e) => agregarPlanta(e.value)}
                                        options={plantasNoAsignadas.map(p => ({ label: p.nombre, value: p.idPlanta }))}
                                        placeholder="Asignar nueva planta..."
                                        className="flex-1"
                                    />
                                </div>
                            )}

                            <Divider className="my-3" />

                            {/* ── SECCIÓN: Observaciones ── */}
                            <h4 className="mt-0 mb-2"><i className="fa-solid fa-comment mr-2 text-primary" />Observaciones</h4>
                            <InputTextarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} autoResize className="w-full" placeholder="Notas técnicas, compatibilidad, etc." />
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

export default CementoForm;
