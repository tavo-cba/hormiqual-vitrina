import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Dropdown, InputText, Calendar } from "primereact";
import { Divider } from "primereact/divider";
import { Fade } from "react-awesome-reveal";
import axios from "axios";
import { config } from "../../../../config/config";
import { useToast } from "../../../../context/ToastContext";
import LoadSpinner from "../../../../common/components/loadspinner/LoadSpinner";
import { useUserContext } from "../../../../context/UserContext";
import { parseLocalDate } from "../../../../common/functions";
// Reutilizamos el componente presentacional de la muestra propia para que
// el layout (Ajustes de muestra + Probetas + mediciones + botones) sea idéntico
// entre muestra propia y muestra de terceros. Acá sólo se replica el bloque
// "Contexto" (que el standalone de propia también renderiza inline) y se
// conserva la lógica específica de terceros: prefijo `M` en lotes,
// `dosificacionTextoLibre` y endpoint `/muestras-terceros`.
import MuestraForm from "../../muestra/uikit/muestraForm";

const mapOpt = (arr = [], l, v) => arr.map(o => ({ label: o[l], value: o[v] }));

const MuestraTercerosForm = () => {
    const { modo, id } = useParams();
    const editing = modo === 'editar';
    const navigate = useNavigate();
    const toast = useToast();
    const { user } = useUserContext();
    const isOperario = !user?.isAdmin;

    const [operadores, setOperadores] = useState([]);
    const [clientes, setClientes] = useState([]);
    const [obras, setObras] = useState([]);
    const [plantas, setPlantas] = useState([]);
    const [tiposHormigon, setTiposHormigon] = useState([]);
    const [estadosProbeta, setEstadosProbeta] = useState([]);
    const [tiposProbeta, setTiposProbeta] = useState([]);
    const [modalidades, setModalidades] = useState([]);
    const [dosificaciones, setDosificaciones] = useState([]);
    const [probetaConfig, setProbetaConfig] = useState({});
    const defaultDays = [
        probetaConfig.probetaSerieUno ?? 7,
        probetaConfig.probetaSerieDos ?? 14,
        probetaConfig.probetaSerieTres ?? 28,
        probetaConfig.probetaSerieCuatro ?? 28,
    ];

    const [fecha, setFecha] = useState(null);
    const [idOperador, setIdOperador] = useState(null);
    const [idCliente, setIdCliente] = useState(null);
    const [idObra, setIdObra] = useState(null);
    const [idPlanta, setIdPlanta] = useState(null);
    const [idTipoHormigon, setIdTipoHormigon] = useState(null);
    const [idTipoProbeta, setIdTipoProbeta] = useState(null);
    const [remito, setRemito] = useState('');
    const [useProbetas, setUseProbetas] = useState(false);
    const [useTemperatura, setUseTemperatura] = useState(false);
    const [probetas, setProbetas] = useState([]);
    const [lote, setLote] = useState(1);
    const [loadNewProbeta, setLoadNewProbeta] = useState(false);
    const [temperaturaAmbiente, setTemperaturaAmbiente] = useState(null);
    const [temperaturaHormigon, setTemperaturaHormigon] = useState(null);
    const [useAsentamiento, setUseAsentamiento] = useState(false);
    const [valorAsentamiento, setValorAsentamiento] = useState(null);
    const [useAireIncorporado, setUseAireIncorporado] = useState(false);
    const [aireIncorporado, setAireIncorporado] = useState(null);
    const [idModalidadMuestra, setIdModalidadMuestra] = useState(null);
    const [idDosificacion, setIdDosificacion] = useState(null);
    const [dosificacionTextoLibre, setDosificacionTextoLibre] = useState('');
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOperario && user?.idEmpleado) {
            setIdOperador(user.idEmpleado);
        }
    }, [isOperario, user?.idEmpleado]);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const [emp, est, tiposProb, cli, ob, pl, horm, cfg, mod, dosifs] = await Promise.all([
                    axios.get(`${config.backendUrl}/api/empleados`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/despachos/estadoprobeta`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/muestras/tipoprobeta`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/clientes`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/obras`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/muestras/tipohormigon`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/config/probetas`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/muestras/modalidades`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/dosificaciones`, { headers: config.headers }).catch(() => ({ data: [] })),
                ]);
                setOperadores(emp.data.map(e => ({ ...e, fullName: `${e.apellido}, ${e.nombre}` })));
                setEstadosProbeta(est.data);
                setTiposProbeta(tiposProb.data);
                setClientes(cli.data);
                setObras(ob.data);
                setPlantas(pl.data);
                setTiposHormigon(horm.data);
                setProbetaConfig(cfg.data);
                setModalidades(mod.data || []);
                setDosificaciones(dosifs.data || []);
            } catch {
                toast('error', 'No se pudieron cargar los catálogos');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    useEffect(() => {
        if (!editing) return;
        (async () => {
            setLoading(true);
            try {
                const { data } = await axios.get(`${config.backendUrl}/api/muestras-terceros/${id}`, { headers: config.headers });
                setFecha(parseLocalDate(data.fecha));
                setIdOperador(data.idOperador);
                setIdCliente(data.idCliente);
                setIdObra(data.idObra);
                setIdPlanta(data.idPlanta);
                setIdTipoHormigon(data.idTipoHormigon);
                setIdTipoProbeta(data.idTipoProbeta);
                setRemito(data.remito ?? '');
                setUseProbetas(!!data.probetas?.length);
                setUseTemperatura(data.temperaturaAmbiente != null || data.temperaturaHormigon != null);
                setUseAsentamiento(data.asentamiento != null);
                setUseAireIncorporado(data.aireincorporado != null);
                setTemperaturaAmbiente(data.temperaturaAmbiente);
                setTemperaturaHormigon(data.temperaturaHormigon);
                setValorAsentamiento(data.asentamiento ?? null);
                setAireIncorporado(data.aireincorporado ?? null);
                setIdModalidadMuestra(data.idModalidadMuestra ?? null);
                setIdDosificacion(data.idDosificacion ?? null);
                setDosificacionTextoLibre(data.dosificacionTextoLibre ?? '');
                if (data.probetas?.length) {
                    const loteActual = data.probetas[0].nombre ? Number(data.probetas[0].nombre.match(/^M(\d+)/)[1]) : 1;
                    const mapped = data.probetas.map((p, idx) => ({
                        idProbeta: p.idProbeta,
                        lote: loteActual,
                        nombre: p.nombre,
                        idEstadoProbeta: p.idEstadoProbeta ?? 1,
                        observaciones: p.observaciones || '',
                        codigo: p.codigo || '',
                        diasRotura:
                            Number(p.diasRotura) ??
                            defaultDays[idx] ??
                            probetaConfig.probetaSerieCuatro ??
                            28,
                    }));
                    setLote(loteActual);
                    setProbetas(renameAndReindex(mapped, loteActual));
                }
            } catch (e) {
                toast('error', 'No se pudo cargar la muestra');
                window.history.back();
            } finally {
                setLoading(false);
            }
        })();
    }, [editing, id]);

    useEffect(() => {
        if (editing) return;
        if (!probetas.length) return;
        (async () => {
            const nuevo = await fetchLote();
            setLote(nuevo);
            setProbetas(prev => renameAndReindex(prev, nuevo));
        })();
    }, [fecha, idPlanta]);

    const renameAndReindex = (arr, lote) =>
        [...arr]
            .sort((a, b) => a.diasRotura - b.diasRotura)
            .map((p, i) => ({
                ...p,
                nombre: `M${lote}P${i + 1}`,
                diasRotura: p.diasRotura ?? defaultDays[i] ?? probetaConfig.probetaSerieCuatro,
            }));

    const fetchLote = async () => {
        if (!fecha || !idPlanta) return 1;
        const fechaISO = fecha.toISOString().slice(0, 10);
        try {
            const { data } = await axios.get(
                `${config.backendUrl}/api/muestras-terceros`,
                { headers: config.headers }
            );
            const lotes = data
                .filter(m => m.fecha.startsWith(fechaISO) && m.idPlanta === idPlanta)
                .map(m => {
                    const nombre = m.probetas?.[0]?.nombre;
                    const match = nombre?.match(/^M(\d+)/);
                    return match ? Number(match[1]) : null;
                })
                .filter(n => n != null)
                .sort((a, b) => a - b);
            let next = 1;
            for (const n of lotes) {
                if (n !== next) break;
                next++;
            }
            return next;
        } catch {
            return 1;
        }
    };

    const addProbeta = async () => {
        setLoadNewProbeta(true);
        let loteActual = lote;
        if (!probetas.length) {
            if (!fecha) {
                setLoadNewProbeta(false);
                return toast('warn', 'Selecciona la fecha primero');
            }
            if (!idPlanta) {
                setLoadNewProbeta(false);
                return toast('warn', 'Selecciona la planta primero');
            }
            loteActual = await fetchLote();
            setLote(loteActual);
        }
        setProbetas(prev =>
            renameAndReindex(
                [
                    ...prev,
                    {
                        lote: loteActual,
                        idEstadoProbeta: 1,
                        observaciones: '',
                        codigo: '',
                        diasRotura: probetaConfig.probetaSerieCuatro ?? 28,
                    },
                ],
                loteActual
            )
        );
        setLoadNewProbeta(false);
    };
    const removeProbeta = idx => setProbetas(prev => {
        const resto = prev.filter((_, i) => i !== idx);
        if (!resto.length) return [];
        return renameAndReindex(resto, lote);
    });
    const handleProbChange = (idx, field, value) => setProbetas(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));

    const handleSave = async () => {
        if (savingRef.current) return;
        if (!fecha || !idOperador || !idCliente || !idPlanta || !idTipoHormigon)
            return toast('warn', 'Completa todos los campos');
        if (useProbetas && !probetas.length) return toast('warn', 'Agrega al menos una probeta');
        // Solo la temperatura del hormigón es obligatoria (ver Tabla 4.2
        // CIRSOC 200-2024 §4.1.1 — evaluación de fresco). La ambiente queda
        // opcional cuando no se midió en obra (s/d).
        if (useTemperatura && temperaturaHormigon == null) return toast('warn', 'Indica la temperatura del hormigón');
        if (useAsentamiento && valorAsentamiento == null) return toast('warn', 'Indica el asentamiento');
        if (useAireIncorporado && aireIncorporado == null) return toast('warn', 'Indica el aire incorporado');
        const payload = {
            fecha: fecha.toISOString().split('T')[0],
            idOperador,
            idCliente,
            idObra,
            idPlanta,
            idTipoHormigon,
            idTipoProbeta,
            idModalidadMuestra: idModalidadMuestra || null,
            idDosificacion: idDosificacion || null,
            dosificacionTextoLibre: !idDosificacion && dosificacionTextoLibre.trim()
                ? dosificacionTextoLibre.trim()
                : null,
            remito: remito || null,
            probetas: useProbetas ? probetas : [],
            cantidadProbetas: useProbetas ? probetas.length : null,
            temperaturaAmbiente: useTemperatura ? temperaturaAmbiente : null,
            temperaturaHormigon: useTemperatura ? temperaturaHormigon : null,
            asentamiento: useAsentamiento ? valorAsentamiento : null,
            aireincorporado: useAireIncorporado ? aireIncorporado : null,
        };
        try {
            savingRef.current = true;
            setSaving(true);
            if (editing) {
                await axios.put(`${config.backendUrl}/api/muestras-terceros/${id}`, payload, { headers: config.headers });
                toast('success', 'Muestra actualizada');
            } else {
                await axios.post(`${config.backendUrl}/api/muestras-terceros`, payload, { headers: config.headers });
                toast('success', 'Muestra registrada');
            }
            window.history.back();
        } catch {
            toast('error', 'Error al guardar');
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="cover-container w-full h-full flex align-self-center justify-content-center"><LoadSpinner /></div>;
    }

    const clienteOpts = clientes.map(c => ({ label: c.tipoPersona === 'Jurídica' ? c.razonSocial : c.nombre, value: c.idCliente }));
    const obraOpts = mapOpt(obras, 'nombre', 'idObra');
    const plantaOpts = mapOpt(plantas, 'nombre', 'idPlanta');
    const hormOpts = mapOpt(tiposHormigon, 'tipoHormigon', 'idTipoHormigon');
    const dosifOpts = dosificaciones.map(d => ({
        label: d.codigoEnPlanta ? `${d.codigoEnPlanta} — ${d.nombre || ''}` : (d.nombre || `Dosificación ${d.idDosificacion}`),
        value: d.idDosificacion,
    }));

    return (
        <Fade direction="up" duration={500} triggerOnce>
            <div className="w-full flex flex-column align-items-center justify-content-center py-5">
                <div className="form-card-header w-full xl:w-10 flex justify-content-between align-items-center">
                    <h3 className="m-0 p-0"><i className="fa-solid fa-pencil mr-2"></i>{editing ? 'Editar muestra' : 'Nueva muestra'}</h3>
                    <i className="fa-solid fa-circle-arrow-left cursor-pointer hover-red" style={{ fontSize: '1.2rem' }} onClick={() => window.history.back()}></i>
                </div>
                <div className="form-card w-full xl:w-10 pb-0">
                    {/* ---------- contexto de la muestra ---------- */}
                    <div className="grid p-1 xl:p-3">
                        <div className="flex flex-column w-full mb-2">
                            <h3 className="m-0 p-0 mb-2">
                                <i className="fa-solid fa-clipboard-list mr-2" />
                                Contexto
                            </h3>
                            <div className="grid">
                                <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                                    <label>Fecha</label>
                                    <Calendar value={fecha} onChange={e => setFecha(e.value)} dateFormat="dd/mm/yy" className="w-full" showIcon />
                                </div>
                                <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                                    <label>Cliente</label>
                                    <Dropdown value={idCliente} onChange={e => setIdCliente(e.value)} options={clienteOpts} filter showClear />
                                </div>
                                <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                                    <label>Tipo de hormigón</label>
                                    <Dropdown value={idTipoHormigon} onChange={e => setIdTipoHormigon(e.value)} options={hormOpts} filter showClear />
                                </div>
                                <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                                    <label>Planta</label>
                                    <Dropdown value={idPlanta} onChange={e => setIdPlanta(e.value)} options={plantaOpts} filter showClear />
                                </div>
                                <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                                    <label>Obra <small className="text-color-secondary">(opcional)</small></label>
                                    <Dropdown value={idObra} onChange={e => setIdObra(e.value)} options={obraOpts} filter showClear />
                                </div>
                                <div className="flex flex-column col-12 sm:col-6 lg:col-6">
                                    <label>Dosificación <small className="text-color-secondary">(opcional)</small></label>
                                    <div className="flex flex-column md:flex-row gap-2">
                                        <Dropdown
                                            value={idDosificacion}
                                            onChange={e => { setIdDosificacion(e.value); if (e.value) setDosificacionTextoLibre(''); }}
                                            options={dosifOpts}
                                            filter
                                            showClear
                                            placeholder="Elegir del catálogo"
                                            className="flex-1"
                                        />
                                        <InputText
                                            value={dosificacionTextoLibre}
                                            onChange={e => setDosificacionTextoLibre(e.target.value)}
                                            placeholder="o ingresar texto libre"
                                            disabled={!!idDosificacion}
                                            className="flex-1"
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                                    <label>Remito <small className="text-color-secondary">(opcional)</small></label>
                                    <InputText value={remito} onChange={e => setRemito(e.target.value)} placeholder="N° de remito" />
                                </div>
                            </div>
                        </div>
                        <Divider className="m-0 mb-3" />
                    </div>

                    <MuestraForm
                        /* modo */
                        embedded={false}
                        isOperario={isOperario}
                        /* fecha base para calc. visual de fechaRotura */
                        fechaDespacho={fecha}
                        horaDespacho={'12:00'}
                        /* estado + setters */
                        idOperador={idOperador}
                        setIdOperador={setIdOperador}
                        useProbetas={useProbetas}
                        setUseProbetas={setUseProbetas}
                        useTemperatura={useTemperatura}
                        setUseTemperatura={setUseTemperatura}
                        useAsentamiento={useAsentamiento}
                        setUseAsentamiento={setUseAsentamiento}
                        useAireIncorporado={useAireIncorporado}
                        setUseAireIncorporado={setUseAireIncorporado}
                        probetas={probetas}
                        addProbeta={addProbeta}
                        removeProbeta={removeProbeta}
                        handleProbChange={handleProbChange}
                        temperaturaAmbiente={temperaturaAmbiente}
                        setTemperaturaAmbiente={setTemperaturaAmbiente}
                        temperaturaHormigon={temperaturaHormigon}
                        setTemperaturaHormigon={setTemperaturaHormigon}
                        valorAsentamiento={valorAsentamiento}
                        setValorAsentamiento={setValorAsentamiento}
                        aireIncorporado={aireIncorporado}
                        setAireIncorporado={setAireIncorporado}
                        idTipoProbeta={idTipoProbeta}
                        setIdTipoProbeta={setIdTipoProbeta}
                        idModalidadMuestra={idModalidadMuestra}
                        setIdModalidadMuestra={setIdModalidadMuestra}
                        /* catálogos */
                        operadores={operadores}
                        estadosProbeta={estadosProbeta}
                        tiposProbeta={tiposProbeta}
                        modalidades={modalidades}
                        /* botones standalone */
                        handleSave={handleSave}
                        saving={saving}
                    />
                </div>
            </div>
        </Fade>
    );
};

export default MuestraTercerosForm;