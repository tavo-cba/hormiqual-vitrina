// src/components/admin/probeta/uikit/EnsayoForm.jsx
import React, { useEffect, useState, useMemo, useRef } from "react";
import {
    InputNumber,
    InputText,
    Calendar,
    Dropdown,
    Divider,
    Message,
    Button,
} from "primereact";
import { confirmDialog } from "primereact/confirmdialog";
import { Fade } from "react-awesome-reveal";
import { useToast } from "../../../../context/ToastContext";
import axios from "axios";
import { config } from "../../../../config/config";
import { parseLocalDate } from "../../../../common/functions";
import FileUploader from "../../../../common/components/upload/FileUploader";
import { useUserContext } from "../../../../context/UserContext";
import { hasRole, ROLES } from "../../../../lib/roles";
import {
    evaluarEnsayoResistencia,
    factorCorreccionHD as lookupFactorHD,
    TIPOS_ROTURA_OPCIONES,
} from "../../../../lib/ensayos/ensayoResistenciaCalc";
import { listLaboratorios } from "../../../../services/laboratorioService";
import "./ensayoForm.css";

/* helper para opciones */
const mapOpt = (arr, l, v) => arr.map(o => ({ label: o[l], value: o[v] }));

// Configuración de dimensiones estándar por tipo de probeta
const TIPO_PROBETA_CONFIG = {
    1: { altura: 200, diametro: 100 }, // 10x20
    2: { altura: 300, diametro: 150 }, // 15x30
    3: { altura: null, diametro: null } // Otra (sin validación)
};

/**
 * Formulario de EnsayoResistencia controlado.
 * - No tiene botón propio.
 * - Cada cambio invoca onSave(payload) automáticamente.
 *
 * Props:
 * - initialData: campos del ensayo
 * - idTipoProbeta: tipo de probeta (1: 10x20, 2: 15x30, 3: otra)
 * - onSave: fn(payload) → se llama tras cada modificación
 */
export default function EnsayoForm({ initialData = {}, idTipoProbeta, idPlantaDespacho, onSave, onPlacaBloqueoChange }) {
    const toast = useToast();

    /* catálogos */
    const [operarios, setOperarios] = useState([]);
    const [prensas, setPrensas] = useState([]);
    // Fase 2 Laboratorio: labs que atienden a la planta del despacho.
    const [laboratorios, setLaboratorios] = useState([]);
    // `equiposByPrensa` ahora se usa también para deducir el lab al que
    // pertenece cada prensa (idEquipo == idPrensa por la convención del seed).
    const [equiposById, setEquiposById] = useState(new Map());

    /* estado local */
    const [peso, setPeso] = useState(initialData.peso ?? null);
    const [altura, setAltura] = useState(initialData.altura ?? null);
    const [diametro, setDiametro] = useState(initialData.diametro ?? null);
    const [fechaEnsayo, setFechaEnsayo] = useState(
        initialData.fechaEnsayo
            ? parseLocalDate(initialData.fechaEnsayo)
            : initialData.fechaRotura
                ? parseLocalDate(initialData.fechaRotura)
                : new Date() // ← hoy por defecto
    );

    const [horaEnsayo, setHoraEnsayo] = useState(
        initialData.horaEnsayo
            ? initialData.horaEnsayo
            : new Date().toTimeString().slice(0, 5) // ← hora actual HH:mm por defecto
    );
    const [idOperarioEnsayo, setOperario] = useState(initialData.idOperarioEnsayo ?? null);
    const [idLaboratorio, setIdLaboratorio] = useState(initialData.idLaboratorio ?? null);
    const [idPrensa, setPrensa] = useState(initialData.idPrensa ?? null);
    const [idUnidadMedidaPrensa, setIdUnidadMedidaPrensa] = useState(initialData.idUnidadMedidaPrensa ?? null);
    const [lecturaPrensa, setLecturaPrensa] = useState(initialData.lecturaPrensa ?? null);
    const [cargaAplicada, setCarga] = useState(initialData.cargaAplicada ?? null);
    const [resistencia, setResistencia] = useState(initialData.resistencia ?? null);
    const [observaciones, setObs] = useState(initialData.observaciones ?? "");
    const [idProbeta, setIdProbeta] = useState(initialData.idProbeta ?? null);
    const [archivos, setArchivos] = useState([]);
    // Bloque 3 (auditoría 08): factor H/D y tipo de rotura — IRAM 1546:2013
    // §10.4 y §11.
    const [factorCorreccionHD, setFactorHD] = useState(
        initialData.factorCorreccionHD != null
            ? Number(initialData.factorCorreccionHD)
            : 1.000
    );
    const [tipoRotura, setTipoRotura] = useState(initialData.tipoRotura ?? null);

    // Estado de placa de elastómero (IRAM 1709)
    const [placaEstado, setPlacaEstado] = useState(null);
    const [placaError, setPlacaError] = useState(null);

    // Estados para errores de validación de dimensiones
    const [errorAltura, setErrorAltura] = useState(null);
    const [errorDiametro, setErrorDiametro] = useState(null);

    const { user } = useUserContext();
    // M-UX-03 fix (auditoría 08, Bloque 1): el operario asignado al ensayo se
    // bloquea para usuarios cuyo único rol es OPERADOR — porque su intención al
    // cargar el ensayo es atribuirse el trabajo. RESPONSABLE_CALIDAD,
    // DIRECTOR_TECNICO y ADMIN pueden elegir el operario (ej. si están cargando
    // un ensayo en nombre de otro). Antes se inferia con `!user?.isAdmin`, que
    // tratraba al RESPONSABLE como operario.
    const esSoloOperador = hasRole(user, ROLES.OPERADOR)
        && !hasRole(user, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN);
    const isOperario = esSoloOperador;

    const unidadCarga = prensas.find(p => p.idPrensa === idPrensa)?.unidadMedida?.unidad ?? "kN";

    // Fase 2: prensas disponibles según el lab elegido.
    //  - Si hay lab → mostramos solo las prensas que pertenecen a ese lab
    //    (idEquipo == idPrensa). Hay lab pero sin prensas asignadas: muestra vacío.
    //  - Si no hay lab pero la planta tiene labs disponibles → user debe elegir
    //    lab primero. Mostramos sólo las prensas de los labs de la planta.
    //  - Si no hay labs para la planta (back-compat) → fallback al filtro viejo
    //    por planta legacy.
    const labsDeLaPlanta = laboratorios; // ya vienen filtradas por planta del despacho
    const prensasFiltradas = useMemo(() => {
        if (idLaboratorio) {
            return prensas.filter(p => {
                const eq = equiposById.get(p.idPrensa);
                return eq && Number(eq.idLaboratorio) === Number(idLaboratorio);
            });
        }
        if (labsDeLaPlanta.length > 0) {
            const labIds = new Set(labsDeLaPlanta.map(l => l.idLaboratorio));
            return prensas.filter(p => {
                const eq = equiposById.get(p.idPrensa);
                return eq && labIds.has(Number(eq.idLaboratorio));
            });
        }
        // Back-compat: sin labs en la planta — filtramos por planta legacy.
        return idPlantaDespacho
            ? prensas.filter(p => p.idPlanta === idPlantaDespacho)
            : prensas;
    }, [prensas, equiposById, idLaboratorio, labsDeLaPlanta, idPlantaDespacho]);

    // localStorage keys scopeadas por planta y por lab.
    const keyPrensaLocalStorage = (lab) =>
        lab ? `selectedPrensa:lab:${lab}` : (idPlantaDespacho ? `selectedPrensa:planta:${idPlantaDespacho}` : 'selectedPrensa');
    const keyLabLocalStorage = idPlantaDespacho ? `selectedLab:planta:${idPlantaDespacho}` : null;

    // Auto-selección del laboratorio:
    //   - 1 lab disponible → auto.
    //   - >1 labs → última elección persistida en localStorage, si aplica.
    //   - 0 labs → fallback (queda null y el form usa filtro legacy por planta).
    useEffect(() => {
        if (idLaboratorio || !laboratorios.length) return;
        if (laboratorios.length === 1) {
            setIdLaboratorio(laboratorios[0].idLaboratorio);
            return;
        }
        if (keyLabLocalStorage) {
            const stored = localStorage.getItem(keyLabLocalStorage);
            if (stored) {
                const storedId = Number(stored);
                if (laboratorios.some(l => l.idLaboratorio === storedId)) {
                    setIdLaboratorio(storedId);
                }
            }
        }
    }, [laboratorios]);

    // Persistir lab elegido por planta.
    useEffect(() => {
        if (idLaboratorio && keyLabLocalStorage) {
            localStorage.setItem(keyLabLocalStorage, String(idLaboratorio));
        }
    }, [idLaboratorio, keyLabLocalStorage]);

    // Si cambia el lab y la prensa actual no pertenece al lab nuevo, limpio.
    useEffect(() => {
        if (!idPrensa || !idLaboratorio) return;
        const eq = equiposById.get(idPrensa);
        if (eq && Number(eq.idLaboratorio) !== Number(idLaboratorio)) {
            setPrensa(null);
            setIdUnidadMedidaPrensa(null);
        }
    }, [idLaboratorio, idPrensa, equiposById]);

    // Auto-selección de la prensa según el lab elegido o fallback.
    useEffect(() => {
        if (idPrensa || !prensas.length) return;

        // Caso con lab elegido
        if (idLaboratorio) {
            const lab = laboratorios.find(l => l.idLaboratorio === idLaboratorio);
            if (prensasFiltradas.length === 1) {
                const p = prensasFiltradas[0];
                setPrensa(p.idPrensa);
                setIdUnidadMedidaPrensa(p.unidadMedida?.idUnidadMedidaPrensa ?? null);
                return;
            }
            if (prensasFiltradas.length > 1 && lab?.idPrensaPorDefecto) {
                const def = prensasFiltradas.find(p => p.idPrensa === lab.idPrensaPorDefecto);
                if (def) {
                    setPrensa(def.idPrensa);
                    setIdUnidadMedidaPrensa(def.unidadMedida?.idUnidadMedidaPrensa ?? null);
                    return;
                }
            }
            // >1 prensas sin default → recurrir a localStorage del lab.
            const stored = localStorage.getItem(keyPrensaLocalStorage(idLaboratorio));
            if (stored) {
                const storedId = Number(stored);
                const sel = prensasFiltradas.find(p => p.idPrensa === storedId);
                if (sel) {
                    setPrensa(sel.idPrensa);
                    setIdUnidadMedidaPrensa(sel.unidadMedida?.idUnidadMedidaPrensa ?? null);
                }
            }
            return;
        }

        // Sin lab elegido → back-compat: usar filtro legacy por planta.
        if (prensasFiltradas.length === 1) {
            const p = prensasFiltradas[0];
            setPrensa(p.idPrensa);
            setIdUnidadMedidaPrensa(p.unidadMedida?.idUnidadMedidaPrensa ?? null);
            return;
        }
        if (prensasFiltradas.length > 1) return; // user elige
        const stored = (keyLabLocalStorage && localStorage.getItem(keyPrensaLocalStorage(null)))
            || localStorage.getItem('selectedPrensa');
        if (stored) {
            const storedId = Number(stored);
            const selected = prensas.find(p => p.idPrensa === storedId);
            if (selected) {
                setPrensa(storedId);
                setIdUnidadMedidaPrensa(selected.unidadMedida?.idUnidadMedidaPrensa ?? null);
            }
        }
    }, [prensas, prensasFiltradas, idLaboratorio, laboratorios]);

    // Pre-selección del operario del ensayo:
    //  - Operador puro → se le atribuye siempre el trabajo (campo bloqueado).
    //  - Resto de roles (RESPONSABLE, DIRECTOR_TECNICO, ADMIN) → pre-seleccionamos
    //    al empleado del usuario logueado como DEFAULT editable, sólo si aún no
    //    hay operario elegido (no pisa una selección manual ni un ensayo en
    //    edición) y si ese empleado figura en la lista cargada.
    useEffect(() => {
        if (isOperario) {
            if (user.idEmpleado !== idOperarioEnsayo) setOperario(user.idEmpleado);
            return;
        }
        if (idOperarioEnsayo == null && user.idEmpleado != null
            && operarios.some((o) => o.idEmpleado === user.idEmpleado)) {
            setOperario(user.idEmpleado);
        }
    }, [isOperario, user.idEmpleado, operarios]);

    // Cargar laboratorios que atienden a la planta del despacho.
    useEffect(() => {
        if (!idPlantaDespacho) {
            setLaboratorios([]);
            return;
        }
        listLaboratorios({ idPlanta: idPlantaDespacho })
            .then((data) => setLaboratorios(Array.isArray(data) ? data : []))
            .catch(() => setLaboratorios([]));
    }, [idPlantaDespacho]);

    // Consultar estado de placa de elastómero al cambiar prensa o diámetro
    useEffect(() => {
        setPlacaError(null);
        if (!idPrensa || !diametro) { setPlacaEstado(null); return; }
        const prensaNombre = prensas.find(p => p.idPrensa === idPrensa)?.nombre;
        if (!prensaNombre) { setPlacaEstado(null); return; }
        const ctrl = new AbortController();
        axios.get(`${config.backendUrl}/api/placas-elastomero/estado-ensayo`, {
            headers: config.headers,
            params: { idPrensa: prensaNombre, diametroProbetaMm: Math.round(diametro) },
            signal: ctrl.signal,
        }).then(res => {
            if (ctrl.signal.aborted) return;
            setPlacaEstado(res.data);
            setPlacaError(null);
        }).catch(err => {
            if (ctrl.signal.aborted || axios.isCancel?.(err)) return;
            console.error("Error consultando estado de placa de elastómero:", err.response?.status, err.response?.data || err.message);
            setPlacaEstado(null);
            setPlacaError(err.response?.data?.error || err.message || "Error de red");
        });
        return () => ctrl.abort();
    }, [idPrensa, diametro, prensas]);

    // Notificar al padre cuando la placa está en estado bloqueante
    useEffect(() => {
        const bloqueado = !!placaEstado && !placaEstado.sinPlaca && (
            placaEstado.estado === 'necesita_extension' || placaEstado.estado === 'bloqueado'
        );
        onPlacaBloqueoChange?.(bloqueado, placaEstado?.estado || null);
    }, [placaEstado]);

    const refetchPlacaEstado = async () => {
        setPlacaError(null);
        if (!idPrensa || !diametro) { setPlacaEstado(null); return; }
        const prensaNombre = prensas.find(p => p.idPrensa === idPrensa)?.nombre;
        if (!prensaNombre) { setPlacaEstado(null); return; }
        try {
            const res = await axios.get(`${config.backendUrl}/api/placas-elastomero/estado-ensayo`, {
                headers: config.headers,
                params: { idPrensa: prensaNombre, diametroProbetaMm: Math.round(diametro) },
            });
            setPlacaEstado(res.data);
        } catch (err) {
            console.error("Error refrescando estado de placa de elastómero:", err.response?.status, err.response?.data || err.message);
            setPlacaEstado(null);
            setPlacaError(err.response?.data?.error || err.message || "Error de red");
        }
    };

    const handleExtenderPlaca = () => {
        const idPlaca = placaEstado?.placa?.idPlacaElastomero;
        if (!idPlaca) return;
        const ext = (placaEstado.extensionesOtorgadas ?? 0) + 1;
        const max = placaEstado.maxExtensiones ?? 0;
        confirmDialog({
            header: "Habilitar uso adicional",
            icon: "fa-solid fa-triangle-exclamation",
            acceptLabel: "Confirmar y extender",
            rejectLabel: "Cancelar",
            acceptClassName: "p-button-warning",
            message: (
                <div>
                    <p className="m-0 mb-2">
                        Está habilitando un uso adicional de las placas Ø{placaEstado.placa.diametroMm} mm
                        (Shore {placaEstado.placa.durezaShoreA}). Esta es la extensión <strong>{ext} de {max}</strong>.
                    </p>
                    <p className="m-0">
                        Confirme que las placas están en buenas condiciones (sin grietas, deformación
                        permanente ni endurecimiento). La acción queda registrada.
                    </p>
                </div>
            ),
            accept: async () => {
                try {
                    const { data } = await axios.post(
                        `${config.backendUrl}/api/placas-elastomero/${idPlaca}/extender`,
                        {},
                        { headers: config.headers }
                    );
                    toast("success", data?.mensaje || "Uso extendido.");
                    await refetchPlacaEstado();
                } catch (err) {
                    toast("error", err.response?.data?.error || "No se pudo extender el uso.");
                }
            },
        });
    };

    // M-UX-06: persistimos la prensa elegida scopeada por lab (preferido) o
    // por planta legacy (back-compat) para usarla como predeterminada.
    useEffect(() => {
        if (idPrensa) {
            localStorage.setItem(keyPrensaLocalStorage(idLaboratorio), String(idPrensa));
        }
    }, [idPrensa, idLaboratorio, idPlantaDespacho]);

    // Autocompletar altura y diámetro según tipo de probeta
    useEffect(() => {
        if (!idTipoProbeta) return;

        const config = TIPO_PROBETA_CONFIG[idTipoProbeta];
        if (!config) return;

        // Solo autocompletar si no hay valores previos (nuevo ensayo)
        if (altura === null && config.altura !== null) {
            setAltura(config.altura);
        }
        if (diametro === null && config.diametro !== null) {
            setDiametro(config.diametro);
        }
    }, [idTipoProbeta]);

    // Validar dimensiones cuando cambian los valores o el tipo de probeta
    useEffect(() => {
        const config = TIPO_PROBETA_CONFIG[idTipoProbeta];
        if (config && config.altura !== null) {
            validarDimension(altura, config.altura, "Altura", setErrorAltura);
        } else {
            setErrorAltura(null);
        }
        if (config && config.diametro !== null) {
            validarDimension(diametro, config.diametro, "Diámetro", setErrorDiametro);
        } else {
            setErrorDiametro(null);
        }
    }, [altura, diametro, idTipoProbeta]);

    // Función para validar dimensiones según tipo de probeta
    const validarDimension = (valor, valorEsperado, nombreCampo, setError) => {
        if (!idTipoProbeta || idTipoProbeta === 3 || valorEsperado === null || valor === null || valor === undefined) {
            setError(null);
            return; // Sin validación para tipo "otra" o sin configuración
        }

        const tolerancia = valorEsperado * 0.05; // ±5%
        const min = valorEsperado - tolerancia;
        const max = valorEsperado + tolerancia;

        if (valor < min || valor > max) {
            setError(`${nombreCampo} fuera del rango permitido: ${min.toFixed(1)} - ${max.toFixed(1)} mm (±5% de ${valorEsperado} mm)`);
        } else {
            setError(null);
        }
    };

    // Handlers con validación para altura y diámetro
    const handleAlturaChange = (e) => {
        const nuevoValor = e.value;
        setAltura(nuevoValor);

        const config = TIPO_PROBETA_CONFIG[idTipoProbeta];
        if (config && config.altura !== null) {
            validarDimension(nuevoValor, config.altura, "Altura", setErrorAltura);
        } else {
            setErrorAltura(null);
        }
    };

    const handleDiametroChange = (e) => {
        const nuevoValor = e.value;
        setDiametro(nuevoValor);

        const config = TIPO_PROBETA_CONFIG[idTipoProbeta];
        if (config && config.diametro !== null) {
            validarDimension(nuevoValor, config.diametro, "Diámetro", setErrorDiametro);
        } else {
            setErrorDiametro(null);
        }
    };

    /* carga catálogos al montar */
    useEffect(() => {
        (async () => {
            try {
                // M-UX-05 (auditoría 08, Bloque 20): acotamos la lista de operarios
                // al personal de calidad de la planta del despacho. Si no hay
                // planta (ensayo sin contexto), traemos todos los operarios de
                // calidad del tenant. Empleados con CLIENTE u otros roles no
                // aparecen en el dropdown.
                const empParams = { soloOperariosLab: true };
                if (idPlantaDespacho) empParams.idPlanta = idPlantaDespacho;
                const [{ data: emp }, { data: pres }, equiposResp] = await Promise.all([
                    axios.get(`${config.backendUrl}/api/empleados`, {
                        headers: config.headers, params: empParams,
                    }),
                    axios.get(`${config.backendUrl}/api/prensas`, { headers: config.headers }),
                    // Recursos MVP Fase D: pedimos también el estado de calibración
                    // de cada prensa. Falla silenciosa si la BD aún no tiene MVP.
                    axios.get(`${config.backendUrl}/api/equipos-laboratorio`, {
                        headers: config.headers,
                        params: { tipo: 'PRENSA' },
                    }).catch(() => ({ data: [] })),
                ]);
                if (idProbeta) {
                    const { data } = await axios.get(
                        `${config.backendUrl}/api/archivos?probeta=${idProbeta}`,
                        { headers: config.headers }
                    );
                    setArchivos(data);
                }
                setOperarios(emp.map(e => ({ ...e, fullName: `${e.apellido}, ${e.nombre}` })));
                // Mergear estado de calibración + idLaboratorio (idEquipo === idPrensa
                // por convención del seed). Persistimos el map en el state para que
                // la lógica de filtrado por lab funcione sin extra fetches.
                const equipoByPrensa = new Map((equiposResp.data || []).map(e => [e.idEquipo, e]));
                setEquiposById(equipoByPrensa);
                setPrensas(pres.map(p => ({
                    ...p,
                    idLaboratorio: equipoByPrensa.get(p.idPrensa)?.idLaboratorio ?? null,
                    // Fase 2026-05-13: el campo vive en `Prensa` y también en
                    // `EquipoLaboratorio`. Si la Prensa no lo trae (back-compat
                    // con prensas viejas), preferimos el del Equipo asociado.
                    tipoOperacion: p.tipoOperacion
                        || equipoByPrensa.get(p.idPrensa)?.tipoOperacion
                        || 'MANUAL',
                    estadoCalibracion: equipoByPrensa.get(p.idPrensa)?.estadoCalibracion || null,
                    diasParaVencer: equipoByPrensa.get(p.idPrensa)?.diasParaVencer ?? null,
                })));
            } catch {
                toast("error", "No se pudieron cargar catálogos de ensayo");
            }
        })();
    }, [idProbeta]);

    // Bloque 3 (auditoría 08, C-LOG-01 + M-CAL-02 + M-MOD-02): el cálculo
    // de carga y resistencia ahora vive en `lib/ensayos/ensayoResistenciaCalc.js`
    // (espejo del engine puro `domain/ensayoResistenciaEvalEngine.js` del
    // backend). El backend recalcula y rechaza si los valores enviados
    // difieren > 1 % — este preview en frontend usa exactamente el mismo
    // engine para que no haya divergencia.
    // Tipo de operación de la prensa seleccionada — define el modo de UI.
    const prensaSeleccionada = prensas.find((p) => p.idPrensa === idPrensa);
    const tipoOperacion = prensaSeleccionada?.tipoOperacion || 'MANUAL';
    const esAutomatica = tipoOperacion === 'AUTOMATICA' || tipoOperacion === 'SEMIAUTOMATICA';

    useEffect(() => {
        // No recalcular hasta tener cargado el catálogo de prensas. En el primer
        // render `prensas` está vacío; sin este guard el branch `!prensa` de
        // abajo corría y hacía setCarga(null)/setResistencia(null), borrando los
        // valores ya cargados de un ensayo en edición. En prensas MANUAL no se
        // notaba (la carga se re-deriva de `lecturaPrensa` al reencontrar la
        // prensa), pero en SEMIAUTOMÁTICAS/AUTOMÁTICAS la carga es input del
        // operario (no derivable) y, una vez borrada, no se recuperaba: al
        // reabrir un ensayo de la prensa Cosacov (SEMIAUTOMATICA) la carga y la
        // resistencia aparecían vacías aunque el backend las tenía guardadas.
        if (!prensas.length) return;
        const prensa = prensas.find((p) => p.idPrensa === idPrensa);
        if (!prensa) {
            // Sin prensa seleccionada, o prensa fuera del catálogo (ej. dada de
            // baja / inactiva): no podemos recalcular, pero NO pisamos los
            // valores persistidos que vinieron en initialData.
            return;
        }
        const out = evaluarEnsayoResistencia({
            lecturaPrensa,
            cargaAplicada,  // sólo se usa si tipoOperacion != MANUAL
            prensa: {
                tipoOperacion: prensa.tipoOperacion || 'MANUAL',
                coeficienteUno: prensa.coeficienteUno,
                coeficienteDos: prensa.coeficienteDos,
                coeficienteTres: prensa.coeficienteTres,
                unidad: prensa.unidadMedida?.unidad ?? null,
            },
            diametro,
            altura,
            factorCorreccionHD: undefined,
        });
        if (!out) {
            // En MANUAL limpiamos carga (la calculamos). En AUTOMATICA, NO
            // tocamos carga: el operario la edita libremente.
            if (!(prensa.tipoOperacion === 'AUTOMATICA' || prensa.tipoOperacion === 'SEMIAUTOMATICA')) {
                setCarga(null);
            }
            setResistencia(null);
            return;
        }
        // En MANUAL, la carga es derivada; el setCarga refresca el campo.
        // En AUTOMATICA la carga la pone el user, pero el engine devuelve el
        // mismo valor — no es destructivo refrescarlo.
        setCarga(out.cargaAplicada);
        setResistencia(out.resistencia);
        setFactorHD(out.factorCorreccionHD);
    }, [lecturaPrensa, cargaAplicada, diametro, altura, idPrensa, prensas]);
    const reloadArchivos = async () => {
        if (!idProbeta) return;
        const { data } = await axios.get(
            `${config.backendUrl}/api/archivos?probeta=${idProbeta}`,
            { headers: config.headers }
        );
        setArchivos(data);
    };

    const deletingFilesRef = useRef(new Set());
    const handleDeleteFile = async (idArchivo) => {
        if (deletingFilesRef.current.has(idArchivo)) return;
        deletingFilesRef.current.add(idArchivo);
        try {
            await axios.delete(`${config.backendUrl}/api/archivos/${idArchivo}`, {
                headers: config.headers,
            });
            toast("success", "Archivo eliminado");
            setArchivos((prev) => prev.filter((a) => a.idArchivo !== idArchivo));
        } catch {
            toast("error", "No se pudo eliminar el archivo");
        } finally {
            deletingFilesRef.current.delete(idArchivo);
        }
    };

    /* cada vez que cambian los campos, notificamos al padre con debounce.
     *
     * M-UX-04 fix (auditoría 08, Bloque 9): antes este useEffect disparaba
     * onSave() en CADA keystroke (peso, altura, diámetro). Si el padre
     * persistía a backend → flood. Ahora debounce 350ms: el usuario tipea
     * y solo se notifica al padre cuando se queda quieto. Si el componente
     * se desmonta antes del flush, se cancela el timer (cleanup).
     */
    useEffect(() => {
        // M-CAL-02 fix (auditoría 08, Bloque 14): `toISOString()` devuelve UTC,
        // lo que en GMT-3 desfasa la fecha cuando el ensayo se carga de noche
        // local (ej. 2026-05-08 22:00 → ISO devuelve "2026-05-09"). Usamos
        // formateo local DD-MM-YYYY → YYYY-MM-DD.
        const fechaLocal = fechaEnsayo
            ? `${fechaEnsayo.getFullYear()}-${String(fechaEnsayo.getMonth() + 1).padStart(2, '0')}-${String(fechaEnsayo.getDate()).padStart(2, '0')}`
            : null;
        const payload = {
            peso,
            altura,
            diametro,
            fechaEnsayo: fechaLocal,
            horaEnsayo,
            idOperarioEnsayo,
            idLaboratorio,
            idPrensa,
            idUnidadMedidaPrensa,
            lecturaPrensa,
            cargaAplicada,
            resistencia,
            observaciones,
            // Bloque 3 auditoría 08
            factorCorreccionHD,
            tipoRotura,
        };
        const timer = setTimeout(() => onSave?.(payload), 350);
        return () => clearTimeout(timer);
    }, [peso, altura, diametro, fechaEnsayo, horaEnsayo, idOperarioEnsayo, idLaboratorio, idPrensa, cargaAplicada, resistencia, observaciones, factorCorreccionHD, tipoRotura]);

    /* render */
    return (
        <Fade direction="in" duration={500} triggerOnce className="w-full">
            <div className="w-full flex flex-column">
                <Divider className="col-12" />
                <div className="col-12">
                    <h3 className="m-0 mb-2"><i className="fa-solid fa-flask-vial mr-2" />Ensayo de resistencia</h3>
                </div>

                {/* Mensajes de validación de dimensiones */}
                {(errorAltura || errorDiametro) && (
                    <div className="col-12 mb-2 ">
                        {errorAltura && (
                            <Message
                                severity="error"
                                text={errorAltura}
                                style={{
                                    width: '100%',
                                    backgroundColor: 'var(--red-500)',
                                    borderColor: 'var(--red-600)',
                                    color: '#ffffff'
                                }}
                                className="mb-2"
                            />
                        )}
                        {errorDiametro && (
                            <Message
                                severity="error"
                                text={errorDiametro}
                                style={{
                                    width: '100%',
                                    backgroundColor: 'var(--red-500)',
                                    borderColor: 'var(--red-600)',
                                    color: '#ffffff',
                                    fontSize: '0.875rem'
                                }}
                            />
                        )}
                    </div>
                )}

                <div className="flex flex-wrap">

                    <div className="col-4 md:col-4">
                        <label>Peso</label>
                        <InputNumber
                            value={peso}
                            onChange={e => setPeso(e.value)}
                            suffix=" grs"
                            minFractionDigits={1}
                            className="w-full"
                            inputClassName="w-full"
                        />
                    </div>
                    <div className="col-4 md:col-4">
                        <label>Altura</label>
                        <InputNumber
                            value={altura}
                            onChange={handleAlturaChange}
                            suffix=" mm"
                            minFractionDigits={2}
                            className="w-full"
                            inputClassName="w-full"
                        />
                    </div>
                    <div className="col-4 md:col-4">
                        <label>Diámetro</label>
                        <InputNumber
                            value={diametro}
                            onChange={handleDiametroChange}
                            suffix=" mm"
                            minFractionDigits={2}
                            className="w-full"
                            inputClassName="w-full"
                        />
                    </div>

                    <div className="col-6 md:col-4">
                        <label>Fecha de ensayo</label>
                        <Calendar
                            value={fechaEnsayo}
                            onChange={e => setFechaEnsayo(e.value)}
                            dateFormat="dd/mm/yy"
                            showIcon
                            showOnFocus={false}
                            className="w-full"
                        />
                    </div>
                    <div className="col-6 md:col-4">
                        <label>Hora de ensayo</label>
                        <InputText
                            type="time"
                            value={horaEnsayo}
                            onChange={e => setHoraEnsayo(e.target.value)}
                            className="w-full"
                        />
                    </div>
                    <div className="col-6 md:col-4">
                        <label>Operario</label>
                        <Dropdown
                            value={idOperarioEnsayo}
                            disabled={isOperario}
                            onChange={e => setOperario(e.value)}
                            options={mapOpt(operarios, "fullName", "idEmpleado")}
                            filter
                            showClear
                            className="w-full"
                        />
                    </div>

                    {/* Fase 2 Laboratorio: dropdown de laboratorio antes que la prensa.
                        Si hay 1 sólo lab para la planta del despacho, se auto-selecciona y
                        este dropdown queda informativo. Si no hay labs (back-compat), no se
                        renderiza y la prensa se filtra por planta legacy. */}
                    {laboratorios.length > 0 && (
                        <div className="col-6 md:col-4">
                            <label>Laboratorio</label>
                            <Dropdown
                                value={idLaboratorio}
                                onChange={e => {
                                    setIdLaboratorio(e.value || null);
                                }}
                                options={mapOpt(laboratorios, "nombre", "idLaboratorio")}
                                filter
                                showClear
                                placeholder="Seleccionar laboratorio"
                                className="w-full"
                            />
                        </div>
                    )}
                    <div className="col-6 md:col-4">
                        <label>Prensa</label>
                        <Dropdown
                            value={idPrensa}
                            onChange={e => {
                                const selectedId = e.value;
                                const selectedPrensa = prensas.find(p => p.idPrensa === selectedId);
                                setPrensa(selectedId);
                                // Persistimos scopeado por lab (preferido) o por planta (legacy).
                                if (selectedId != null) {
                                    localStorage.setItem(keyPrensaLocalStorage(idLaboratorio), String(selectedId));
                                }
                                setIdUnidadMedidaPrensa(selectedPrensa?.unidadMedida?.idUnidadMedidaPrensa ?? null);
                            }}
                            options={mapOpt(prensasFiltradas, "nombre", "idPrensa")}
                            filter
                            showClear
                            className="w-full"
                        />
                        {/* Recursos MVP Fase D: aviso de calibración si la prensa
                            elegida no tiene calibración vigente. ISO 17025 §6.4.7
                            exige trazabilidad activa. El ensayo igualmente se
                            persiste (no bloqueamos), pero el operario debe saberlo. */}
                        {(() => {
                            const p = prensas.find(x => x.idPrensa === idPrensa);
                            if (!p || !p.estadoCalibracion) return null;
                            if (p.estadoCalibracion === 'sin_calibrar') {
                                return (
                                    <Message
                                        severity="warn"
                                        className="w-full mt-1"
                                        content={
                                            <span className="text-xs">
                                                <i className="fa-solid fa-triangle-exclamation mr-1" />
                                                Esta prensa <strong>no tiene calibración registrada</strong>.
                                                El ensayo quedará con trazabilidad débil (ISO 17025 §6.4.7).
                                                Registrar calibración en <em>Calidad → Recursos</em>.
                                            </span>
                                        }
                                    />
                                );
                            }
                            if (p.estadoCalibracion === 'vencida') {
                                const dias = p.diasParaVencer != null ? Math.abs(p.diasParaVencer) : null;
                                return (
                                    <Message
                                        severity="error"
                                        className="w-full mt-1"
                                        content={
                                            <span className="text-xs">
                                                <i className="fa-solid fa-circle-xmark mr-1" />
                                                Calibración <strong>VENCIDA</strong>
                                                {dias != null && ` hace ${dias} día${dias === 1 ? '' : 's'}`}.
                                                El ensayo quedará con trazabilidad débil (ISO 17025 §6.4.7).
                                                Registrar nueva calibración antes de continuar.
                                            </span>
                                        }
                                    />
                                );
                            }
                            if (p.estadoCalibracion === 'por_vencer') {
                                return (
                                    <Message
                                        severity="warn"
                                        className="w-full mt-1"
                                        content={
                                            <span className="text-xs">
                                                <i className="fa-solid fa-clock mr-1" />
                                                Calibración por vencer en {p.diasParaVencer} día{p.diasParaVencer === 1 ? '' : 's'}.
                                                Gestionar renovación pronto.
                                            </span>
                                        }
                                    />
                                );
                            }
                            return null;
                        })()}
                    </div>
                    {/* MANUAL: input "Divisor" (lectura del dial) + carga calculada.
                        AUTOMATICA/SEMI: input "Carga aplicada" directo desde la prensa,
                        sin divisor ni ecuación. */}
                    {esAutomatica ? (
                        <div className="col-6 md:col-4">
                            <label title="La prensa automática reporta la carga directamente">
                                Carga aplicada
                            </label>
                            <InputNumber
                                value={cargaAplicada}
                                onChange={e => setCarga(e.value)}
                                suffix={` ${unidadCarga}`}
                                minFractionDigits={2}
                                className="w-full"
                                inputClassName="w-full"
                                disabled={!idPrensa}
                            />
                        </div>
                    ) : (
                        <div className="col-6 md:col-4">
                            <label>Divisor</label>
                            <InputNumber
                                value={lecturaPrensa}
                                onChange={e => setLecturaPrensa(e.value)}
                                minFractionDigits={2}
                                className="w-full"
                                inputClassName="w-full"
                                disabled={!idPrensa}
                            />
                        </div>
                    )}
                    <div className="col-6 md:col-4">
                        <label>Resistencia</label>
                        <InputNumber
                            value={resistencia}
                            onChange={e => setResistencia(e.value)}
                            suffix=" MPa"
                            minFractionDigits={2}
                            className="w-full"
                            disabled
                            inputClassName="w-full"
                        />
                    </div>

                    {/* R5 (revisor-civil 2026-05-08): Relación H/D informativa.
                        Antes era un input editable con factor de corrección — atribución
                        incorrecta a IRAM 1546:2013 §10.4 (sección inexistente). El
                        factor real es de IRAM 1551 (testigos extraídos). Para probetas
                        moldeadas, IRAM 1524/1534 exige H/D=2: si está fuera de
                        tolerancia se descarta, sin corregir. */}
                    {(() => {
                        const hdReal = altura && diametro ? altura / diametro : null;
                        const hdFueraTol = hdReal != null && (hdReal < 1.90 || hdReal > 2.10);
                        return (
                            <div className="col-6 md:col-4">
                                <label title="IRAM 1524/1534 — H/D obligatorio = 2 al moldear">
                                    Relación H/D <i className="fa-solid fa-circle-info ml-1" style={{ fontSize: '0.75rem', opacity: 0.7 }} />
                                </label>
                                <InputText
                                    value={hdReal != null ? hdReal.toFixed(3) : '—'}
                                    disabled
                                    className={`w-full${hdFueraTol ? ' p-invalid' : ''}`}
                                    tooltip={hdFueraTol
                                        ? `H/D=${hdReal.toFixed(3)} fuera de tolerancia [1.900, 2.100]. Descartar la probeta — IRAM 1524/1534 exige H/D=2.`
                                        : 'H/D dentro de tolerancia ±5% sobre el valor 2.000.'}
                                    tooltipOptions={{ position: 'top' }}
                                />
                                {hdFueraTol && (
                                    <small className="block mt-1" style={{ color: 'var(--red-500)' }}>
                                        <i className="fa-solid fa-triangle-exclamation mr-1" />
                                        H/D fuera de tolerancia. Descartar (IRAM 1524/1534).
                                    </small>
                                )}
                            </div>
                        );
                    })()}
                    <div className="col-6 md:col-4">
                        <label title="IRAM 1546:2013 §11">Tipo de rotura</label>
                        <Dropdown
                            value={tipoRotura}
                            onChange={(e) => setTipoRotura(e.value)}
                            options={TIPOS_ROTURA_OPCIONES}
                            placeholder="Seleccionar (IRAM 1546 §11)"
                            showClear
                            className="w-full"
                        />
                    </div>
                </div>

                {/* ── Contador de placa de elastómero (IRAM 1709) ── */}
                {placaEstado && !placaEstado.sinPlaca && placaEstado.placa && (() => {
                    const variant =
                        placaEstado.estado === 'bloqueado' ? 'placa-card--blocked' :
                        placaEstado.estado === 'necesita_extension' || placaEstado.estado === 'extendido' ? 'placa-card--warn' :
                        placaEstado.estado === 'proximo' ? 'placa-card--proximo' :
                        'placa-card--ok';
                    const iconClass =
                        placaEstado.estado === 'bloqueado' ? 'fa-ban' :
                        placaEstado.estado === 'necesita_extension' || placaEstado.estado === 'extendido' ? 'fa-triangle-exclamation' :
                        placaEstado.estado === 'proximo' ? 'fa-clock' :
                        'fa-circle-check';
                    const barColor = placaEstado.pctUso >= 100 ? '#ef4444' : placaEstado.pctUso >= 90 ? '#f59e0b' : '#22c55e';
                    return (
                        <div className="col-12">
                            <div className={`placa-card ${variant}`}>
                                <i className={`placa-card__icon fa-solid ${iconClass}`} />
                                <div className="placa-card__body">
                                    <div className="placa-card__row">
                                        <span className="placa-card__title">
                                            Placas Ø{placaEstado.placa.diametroMm} mm — Shore {placaEstado.placa.durezaShoreA}
                                            {placaEstado.extensionesOtorgadas > 0 && (
                                                <span className="placa-card__ext-badge" title={`${placaEstado.extensionesOtorgadas} extensión(es) otorgada(s) sobre el límite normativo`}>
                                                    +{placaEstado.extensionesOtorgadas} ext.
                                                </span>
                                            )}
                                        </span>
                                        <span className="placa-card__counter">
                                            {placaEstado.placa.reusosActuales} / {placaEstado.limiteTotal}
                                            {placaEstado.restantes > 0 && <span className="placa-card__rest">({placaEstado.restantes} rest.)</span>}
                                        </span>
                                    </div>
                                    <div className="placa-card__bar">
                                        <div
                                            className="placa-card__bar-fill"
                                            style={{ width: `${Math.min(100, placaEstado.pctUso)}%`, background: barColor }}
                                        />
                                    </div>
                                    {placaEstado.estado === 'extendido' && (
                                        <div className="placa-card__extended-note">
                                            <i className="fa-solid fa-circle-info mr-1" />
                                            Operando con extensiones: {placaEstado.extensionesOtorgadas} de {placaEstado.maxExtensiones} otorgadas. Límite total: {placaEstado.limiteTotal} usos.
                                        </div>
                                    )}
                                </div>
                                {placaEstado.diferenciaDiametro > 5 && (
                                    <span className="placa-card__diff-warn" title="Diferencia de diámetro entre probeta y placa">
                                        <i className="fa-solid fa-triangle-exclamation mr-1" />Ø ±{placaEstado.diferenciaDiametro.toFixed(1)} mm
                                    </span>
                                )}
                            </div>
                            {placaEstado.estado === 'bloqueado' && (
                                <Message severity="error" text="Placas agotadas. Debe reemplazar el juego antes de continuar." className="w-full mt-2" />
                            )}
                            {placaEstado.estado === 'necesita_extension' && (
                                <div className="placa-extension-banner">
                                    <div className="placa-extension-banner__content">
                                        <i className="placa-extension-banner__icon fa-solid fa-triangle-exclamation" />
                                        <div className="placa-extension-banner__text">
                                            Alcanzó el límite normativo ({placaEstado.limiteNorma} usos). Extienda el uso (de a 1, hasta {placaEstado.maxExtensiones} extensiones) o reemplace el juego.
                                            {placaEstado.extensionesOtorgadas > 0 && (
                                                <span className="placa-extension-banner__sub">
                                                    Extensiones usadas: {placaEstado.extensionesOtorgadas} / {placaEstado.maxExtensiones}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {placaEstado.puedeExtender && (
                                        <Button
                                            type="button"
                                            className="placa-extension-banner__btn"
                                            label="Extender uso (+1)"
                                            icon="fa-solid fa-plus"
                                            size="small"
                                            onClick={(e) => { e.preventDefault(); handleExtenderPlaca(); }}
                                            tooltip="Habilitar un uso adicional verificando estado de las placas"
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })()}
                {placaEstado?.sinPlaca && idPrensa && diametro && (
                    <div className="col-12">
                        <Message severity="info" text="Sin placas de elastómero activas para esta prensa. Registre un juego en Calidad → Placas de elastómero." className="w-full" />
                    </div>
                )}
                {placaError && idPrensa && diametro && (
                    <div className="col-12">
                        <Message severity="error" text={`No se pudo verificar el estado de placas de elastómero: ${placaError}`} className="w-full" />
                    </div>
                )}

                <div className="col-12">
                    <label>Observaciones</label>
                    <InputText
                        value={observaciones}
                        onChange={e => setObs(e.target.value)}
                        className="w-full"
                    />
                </div>
                <div className="mt-4">
                    <h3 className="m-0 mb-2"><i className="fa-solid fa-upload mr-2" />Subida de archivos</h3>
                    <div className="upload-container p-0 xl:p-4 xl:pt-2">
                        <FileUploader
                            multiple
                            accept="application/pdf,image/*"
                            extraFields={{ idProbeta }}
                            onUploaded={reloadArchivos}
                        />
                    </div>
                </div>

                {!!archivos.length && (
                    <div className="col-12 mb-3">
                        <h4 className="mb-2"><i className="fa-solid fa-file mr-2"></i>Archivos cargados</h4>
                        {archivos.map((a) => (
                            <div
                                key={a.idArchivo}
                                className="file-uploaded flex align-items-center justify-content-between bg-surface-50 p-3 border-round mb-2"
                            >
                                <div className="flex align-items-center gap-2">
                                    {/* miniatura o icono */}
                                    {a.mimeType.startsWith("image/") ? (
                                        <i className="fa-solid fa-image" style={{ fontSize: "1.4rem" }} />
                                    ) : (
                                        <i className="fa-solid fa-file-lines" style={{ fontSize: "1.4rem" }} />
                                    )}
                                    <a href={a.url} target="_blank" rel="noreferrer" className="text-primary">
                                        {a.nombreOriginal}
                                    </a>
                                </div>
                                <i
                                    className="fa-solid fa-trash cursor-pointer text-red-400 hover:text-red-300"
                                    onClick={() => handleDeleteFile(a.idArchivo)}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Fade>
    );
}
