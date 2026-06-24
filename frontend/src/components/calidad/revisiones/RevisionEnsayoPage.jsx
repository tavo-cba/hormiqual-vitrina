import React, { useEffect, useState, useMemo, useContext, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Fade } from "react-awesome-reveal";
import { Button } from "primereact/button";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Chart as PrimeChart } from "primereact/chart";
import { ProgressSpinner } from "primereact/progressspinner";
import { Message } from "primereact/message";
import { confirmDialog } from "primereact/confirmdialog";
import { Dialog } from "primereact/dialog";
import axios from "axios";
import { config } from "../../../config/config";
import { formatDateDMY, parseLocalDate, toLocalDate, dateToYMDLocal } from "../../../common/functions";
import { useMenuContext } from "../../../context/MenuContext";
import { useToast } from "../../../context/ToastContext";
import { ThemeContext } from "../../../context/ThemeContext";
import { useUserContext } from "../../../context/UserContext";
import { useCanPerform } from "../../../lib/roles/useCanPerform";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import MotivoDialog from "../../../common/components/MotivoDialog/MotivoDialog";
import { esUnidadToneladaFuerza } from "../../../lib/ensayos/ensayoResistenciaCalc";
import { getFactorEdad, getColorCumplimiento } from "./RevisionesEnsayo";

const severityMap = { green: 'success', orange: 'warning', red: 'danger' };
const colorHex = { green: '#22c55e', orange: '#f59e0b', red: '#ef4444' };

export default function RevisionEnsayoPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { isDark } = useContext(ThemeContext);
    const { getActions } = useMenuContext();
    const { user } = useUserContext();
    const can = useCanPerform(user);
    const puedeEditar = getActions('/calidad/revisiones-ensayos').puedeEditar;
    const puedeAprobar = puedeEditar && can('ensayo.aprobar');
    const puedeDesaprobar = can('ensayo.desaprobar');

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [ensayo, setEnsayo] = useState(null);
    const [hermanas, setHermanas] = useState([]);

    // Campos editables
    const [peso, setPeso] = useState(null);
    const [altura, setAltura] = useState(null);
    const [diametro, setDiametro] = useState(null);
    const [fechaEnsayo, setFechaEnsayo] = useState(null);
    const [horaEnsayo, setHoraEnsayo] = useState('');
    const [idOperarioEnsayo, setIdOperarioEnsayo] = useState(null);
    const [idPrensa, setIdPrensa] = useState(null);
    const [lecturaPrensa, setLecturaPrensa] = useState(null);
    const [cargaAplicada, setCargaAplicada] = useState(null);
    const [resistencia, setResistencia] = useState(null);
    const [observaciones, setObservaciones] = useState('');

    // Catalogos
    const [operarios, setOperarios] = useState([]);
    const [prensasRaw, setPrensasRaw] = useState([]);
    const [prensasOpts, setPrensasOpts] = useState([]);

    // Historial de dosificación
    const [historial, setHistorial] = useState([]);

    // Punto del historial seleccionado (click en gráfico)
    const [selectedPoint, setSelectedPoint] = useState(null);
    const [puntoProbetas, setPuntoProbetas] = useState([]);
    const [loadingPunto, setLoadingPunto] = useState(false);

    // C-SEC-04: motivoAjuste cuando hay diff entre carga editada y aprobada.
    // Mej-17: motivoDesaprobacion al revertir una aprobación.
    const [motivoDialog, setMotivoDialog] = useState(null);
    // motivoDialog shape: { mode: 'aprobar' | 'desaprobar', payload?, diffs? }

    const unidadCarga = prensasRaw.find(p => p.idPrensa === idPrensa)?.unidadMedida?.unidad ?? "kN";

    const calcularCargaReal = () => {
        if (lecturaPrensa == null || !idPrensa) return null;
        const prensa = prensasRaw.find(p => p.idPrensa === idPrensa);
        const c1 = Number(prensa?.coeficienteUno);
        const c2 = Number(prensa?.coeficienteDos);
        const c3 = Number(prensa?.coeficienteTres);
        const v = Number(lecturaPrensa);
        if (isNaN(v)) return null;
        if ([c1, c2, c3].some(n => isNaN(n))) return v;
        return c1 * v * v + c2 * v - c3;
    };

    const calcularResistenciaFromCarga = (carga) => {
        if (!carga || !diametro) return null;
        const d = Number(diametro);
        const Q = Number(carga);
        if (!d || d === 0) return null;
        // M-CAL-03 (auditoría 08, Bloque 14): el `.includes("ton")` anterior
        // fallaba con variantes "Tn" / "tonf" / "tonelada-fuerza". Usamos el
        // helper canónico (regex con \b) compartido con el motor backend.
        const f = esUnidadToneladaFuerza(unidadCarga) ? 12486.214581 : 1273.239545;
        return +(f * Q / (d * d)).toFixed(2);
    };

    // Recalcular carga y resistencia cuando cambian divisor, diametro o prensa
    useEffect(() => {
        if (!prensasRaw.length) return;
        const cargaReal = calcularCargaReal();
        setCargaAplicada(cargaReal);
        const nuevaRes = calcularResistenciaFromCarga(cargaReal);
        setResistencia(nuevaRes);
    }, [lecturaPrensa, diametro, idPrensa, prensasRaw]);

    useEffect(() => {
        if (!id) return;
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            try {
                // Sprint 5 M3 (sesión 2026-05-10): pedimos también el estado
                // de calibración de las prensas para advertir al revisor si
                // está aprobando con una prensa sin calibración vigente.
                // Fallback silencioso si el endpoint no existe (BD pre-MVP).
                const [detRes, opRes, prRes, equiposResp] = await Promise.all([
                    axios.get(`${config.backendUrl}/api/probetas/ensayo-revision/${id}`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/empleados`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/prensas`, { headers: config.headers }),
                    axios.get(`${config.backendUrl}/api/equipos-laboratorio`, {
                        headers: config.headers,
                        params: { tipo: 'PRENSA' },
                    }).catch(() => ({ data: [] })),
                ]);
                if (cancelled) return;

                const { ensayo: e, hermanas: h } = detRes.data;
                setEnsayo(e);
                setHermanas(h || []);

                setPeso(Number(e.peso));
                setAltura(Number(e.altura));
                setDiametro(Number(e.diametro));
                setFechaEnsayo(e.fechaEnsayo ? parseLocalDate(e.fechaEnsayo) : null);
                setHoraEnsayo(e.horaEnsayo || '');
                setIdOperarioEnsayo(e.idOperarioEnsayo);
                setIdPrensa(e.idPrensa);
                setLecturaPrensa(e.lecturaPrensa != null ? Number(e.lecturaPrensa) : null);
                setCargaAplicada(Number(e.cargaAplicada));
                setResistencia(Number(e.resistencia));
                setObservaciones(e.observaciones || '');

                setOperarios(opRes.data.map(o => ({
                    label: `${o.apellido}, ${o.nombre}`,
                    value: o.idEmpleado,
                })));
                // Mergear estado de calibración (idPrensa == idEquipo por
                // convención del seed de Recursos MVP migration 20260510c).
                const equipoByPrensa = new Map((equiposResp.data || []).map((eq) => [eq.idEquipo, eq]));
                const prensasConCal = prRes.data.map((p) => ({
                    ...p,
                    estadoCalibracion: equipoByPrensa.get(p.idPrensa)?.estadoCalibracion || null,
                    diasParaVencer:    equipoByPrensa.get(p.idPrensa)?.diasParaVencer ?? null,
                }));
                setPrensasRaw(prensasConCal);
                setPrensasOpts(prensasConCal.map(p => ({
                    label: p.nombre || `${p.marca} ${p.modelo}`,
                    value: p.idPrensa,
                })));

                await loadHistorial(e);
            } catch (err) {
                // Sprint 5 M1: catch ya no es silencioso.
                console.error('[RevisionEnsayoPage] load:', err);
                toast('error', 'No se pudo cargar el ensayo a revisar.');
                setEnsayo(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [id]);

    const loadHistorial = async (e) => {
        try {
            const idDos = e.probeta?.muestra?.despacho?.dosificacion?.idDosificacion;
            const tipoH = e.probeta?.muestraTerceros?.tipoHormigon?.idTipoHormigon;
            const edadDis = e.probeta?.muestra?.despacho?.dosificacion?.edadDisenio?.dias;
            if ((!idDos && !tipoH) || !edadDis) return;

            const queryParams = { edadDiseno: edadDis };
            if (idDos) queryParams.idDosificacion = idDos;
            else queryParams.idTipoHormigon = tipoH;

            const { data } = await axios.get(
                `${config.backendUrl}/api/probetas/resistencias`,
                {
                    headers: config.headers,
                    params: queryParams,
                }
            );
            if (data?.main?.length) {
                const detalles = data.main.flatMap(lote => lote.detalles || []);
                detalles.sort((a, b) => toLocalDate(a.fechaToma || a.fechaConfeccion) - toLocalDate(b.fechaToma || b.fechaConfeccion));
                setHistorial(detalles.slice(-30));
            }
        } catch (err) {
            // Sprint 5 M1: historial es un nice-to-have del chart — si falla
            // no abortamos la revisión pero al menos lo logueamos.
            console.warn('[RevisionEnsayoPage] loadHistorial:', err.message || err);
            setHistorial([]);
        }
    };

    // Info de la probeta
    const probeta = ensayo?.probeta;
    const despacho = probeta?.muestra?.despacho;
    const muestraTerceros = probeta?.muestraTerceros;
    const tipoHormigon = despacho?.dosificacion?.tipoHormigon?.tipoHormigon
        || muestraTerceros?.tipoHormigon?.tipoHormigon || '-';
    const dosificacionNombre = despacho?.dosificacion?.nombre || null;
    const edadDisenio = despacho?.dosificacion?.edadDisenio?.dias ?? null;
    const resObjetivoMatch = tipoHormigon.match(/\d+/);
    const resObjetivo = resObjetivoMatch ? Number(resObjetivoMatch[0]) : null;

    // Color de cumplimiento
    const color = getColorCumplimiento(resistencia, resObjetivo, ensayo?.edadEnsayo, edadDisenio);
    const factor = getFactorEdad(ensayo?.edadEnsayo, edadDisenio);
    const meta = resObjetivo && factor ? (resObjetivo * factor).toFixed(1) : null;

    // Chart data para historial
    const chartData = useMemo(() => {
        if (!historial.length || !resObjetivo) return null;
        const labels = historial.map((d, i) => d.fechaToma ? formatDateDMY(d.fechaToma) : `#${i + 1}`);
        const valores = historial.map(d => d.resistenciaPromedio ?? d.resistencia ?? null);
        return {
            labels,
            datasets: [
                {
                    label: 'Resistencia (MPa)',
                    data: valores,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 3,
                },
                {
                    label: `Objetivo (${resObjetivo} MPa)`,
                    data: Array(labels.length).fill(resObjetivo),
                    borderColor: '#22c55e',
                    borderDash: [6, 3],
                    pointRadius: 0,
                    fill: false,
                },
            ],
        };
    }, [historial, resObjetivo]);

    // Sprint 5 M2 (sesión 2026-05-10): colores del chart derivados de
    // `isDark` y recalculados en cada cambio de tema. Antes se leía con
    // `getComputedStyle` UNA vez al mount → el chart conservaba colores
    // viejos al toggear light/dark.
    const textColor          = isDark ? '#E5E7EB' : '#374151';
    const textColorSecondary = isDark ? '#9CA3AF' : '#6B7280';
    const surfaceBorder      = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

    const chartOptions = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { bottom: 0, top: 0 } },
        plugins: {
            legend: {
                position: 'bottom',
                labels: { usePointStyle: true, color: textColor, padding: 10, boxWidth: 8 },
            },
        },
        scales: {
            y: {
                title: { display: true, text: 'MPa', color: textColorSecondary },
                beginAtZero: false,
                ticks: { color: textColorSecondary },
                grid: { color: surfaceBorder },
            },
            x: {
                ticks: { maxRotation: 45, color: textColorSecondary },
                grid: { color: surfaceBorder },
            },
        },
        onClick: (_event, elements) => {
            if (!elements || elements.length === 0) return;
            const idx = elements[0].index;
            const punto = historial[idx];
            if (!punto) return;
            setSelectedPoint(punto);
            fetchPuntoProbetas(punto.idMuestra);
        },
    }), [textColor, textColorSecondary, surfaceBorder, historial]);

    const buildAprobarPayload = () => ({
        peso, altura, diametro,
        // M-CAL-02 (auditoría 08, Bloque 14): formateo local para no desfasar
        // la fecha en GMT-3 cuando el revisor aprueba de noche.
        fechaEnsayo: dateToYMDLocal(fechaEnsayo) ?? undefined,
        horaEnsayo: horaEnsayo || undefined,
        idOperarioEnsayo, idPrensa, lecturaPrensa,
        cargaAplicada, resistencia, observaciones,
    });

    // C-SEC-04: el backend rechaza con 400+diffs si hay cambios respecto al
    // valor cargado originalmente y no se envía motivoAjuste. Cuando eso pasa
    // abrimos el MotivoDialog con la lista de cambios y reintentamos con motivo.
    const enviarAprobacion = async (payload, motivoAjuste = undefined) => {
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try {
            await axios.put(
                `${config.backendUrl}/api/probetas/ensayo/${id}/aprobar`,
                motivoAjuste ? { ...payload, motivoAjuste } : payload,
                { headers: config.headers }
            );
            toast('success', 'Ensayo aprobado');
            navigate('/calidad/revisiones-ensayos');
        } catch (err) {
            const data = err.response?.data;
            if (err.response?.status === 400 && Array.isArray(data?.diffs) && data.diffs.length > 0 && !motivoAjuste) {
                // C-SEC-04: pedir motivo y reintentar.
                setMotivoDialog({ mode: 'aprobar', payload, diffs: data.diffs });
                return;
            }
            console.error(err);
            toast('error', data?.error || err.message || 'Error al aprobar');
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const handleAprobar = () => {
        confirmDialog({
            header: 'Aprobar ensayo',
            message: (
                <div className="flex flex-column align-items-center gap-3 py-3">
                    <i className="fa-solid fa-circle-check" style={{ fontSize: '3rem', color: '#22c55e' }} />
                    <div className="text-center">
                        <div className="font-semibold text-lg mb-1">
                            {probeta?.nombre || probeta?.codigo} - {tipoHormigon}
                        </div>
                        <div className="text-500">
                            Resistencia: <strong>{resistencia ? `${Number(resistencia).toFixed(1)} MPa` : '-'}</strong>
                        </div>
                        {/* Sprint 6 B2 (sesión 2026-05-10) — texto explícito
                            de responsabilidad técnica. Antes el mensaje
                            solo decía "quedará disponible en reportes",
                            minimizando la implicancia normativa. */}
                        <div className="text-sm mt-3 text-left" style={{
                            background: 'var(--surface-100, rgba(0,0,0,0.04))',
                            padding: '0.75rem',
                            borderRadius: 6,
                            borderLeft: '3px solid var(--blue-500)',
                        }}>
                            <i className="fa-solid fa-circle-info mr-2 text-primary" />
                            Al aprobar usted asume la <strong>responsabilidad técnica</strong> de
                            validación de este ensayo conforme a <strong>IRAM 1666:2020 §A.7.10</strong>.
                            Su nombre quedará registrado como firmante en el histórico del ensayo
                            (auditable según ISO/IEC 17025 §7.8). El ensayo aprobado pasa a integrar
                            cálculos de aceptación contractual (CIRSOC 200-2024 §6.2.3 / §6.2.4),
                            quedará disponible en reportes y se enviará al portal de clientes.
                        </div>
                    </div>
                </div>
            ),
            acceptLabel: 'Aprobar y firmar',
            rejectLabel: 'Cancelar',
            acceptIcon: 'fa-solid fa-check mr-2',
            acceptClassName: 'p-button-success',
            rejectClassName: 'p-button-outlined p-button-secondary',
            accept: () => enviarAprobacion(buildAprobarPayload()),
        });
    };

    // Mej-17: desaprobar un ensayo ya aprobado, con motivo + trazabilidad.
    const handleDesaprobar = () => {
        setMotivoDialog({ mode: 'desaprobar' });
    };

    const onMotivoConfirm = async (motivo) => {
        if (!motivoDialog) return;
        if (motivoDialog.mode === 'aprobar') {
            await enviarAprobacion(motivoDialog.payload, motivo);
            return;
        }
        if (motivoDialog.mode === 'desaprobar') {
            try {
                await axios.post(
                    `${config.backendUrl}/api/probetas/ensayo/${id}/desaprobar`,
                    { motivo },
                    { headers: config.headers }
                );
                toast('success', 'Ensayo desaprobado');
                navigate('/calidad/revisiones-ensayos');
            } catch (err) {
                console.error(err);
                toast('error', err.response?.data?.error || err.message || 'Error al desaprobar');
                throw err;
            }
        }
    };

    const handleDeleteProbeta = (p) => {
        confirmDialog({
            header: 'Eliminar probeta',
            message: (
                <div className="flex flex-column align-items-center gap-3 py-3">
                    <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '2.5rem', color: '#ef4444' }} />
                    <div className="text-center">
                        <div className="font-semibold text-lg mb-1">{p.nombre || p.codigo}</div>
                        <div className="text-500 text-sm">Esta acción no se puede deshacer.</div>
                    </div>
                </div>
            ),
            acceptLabel: 'Eliminar',
            rejectLabel: 'Cancelar',
            acceptClassName: 'p-button-danger',
            rejectClassName: 'p-button-outlined p-button-secondary',
            accept: async () => {
                try {
                    await axios.delete(
                        `${config.backendUrl}/api/probetas/${p.idProbeta}`,
                        { headers: config.headers }
                    );
                    toast('success', 'Probeta eliminada');
                    setPuntoProbetas((prev) => prev.filter((x) => x.idProbeta !== p.idProbeta));
                } catch (err) {
                    toast('error', err.response?.data?.error || 'Error al eliminar');
                }
            },
        });
    };

    const handleDeleteLote = () => {
        if (!selectedPoint) return;
        confirmDialog({
            header: 'Eliminar lote completo',
            message: (
                <div className="flex flex-column align-items-center gap-3 py-3">
                    <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '2.5rem', color: '#ef4444' }} />
                    <div className="text-center">
                        <div className="font-semibold text-lg mb-1">Lote del {formatDateDMY(selectedPoint.fechaToma)}</div>
                        {selectedPoint.remito && (
                            <div className="text-500 text-sm">Remito: {selectedPoint.remito}</div>
                        )}
                        <div className="text-500 text-sm mt-1">
                            Se eliminarán el lote y todas sus probetas. Esta acción no se puede deshacer.
                        </div>
                    </div>
                </div>
            ),
            acceptLabel: 'Eliminar lote',
            rejectLabel: 'Cancelar',
            acceptClassName: 'p-button-danger',
            rejectClassName: 'p-button-outlined p-button-secondary',
            accept: async () => {
                try {
                    await axios.delete(
                        `${config.backendUrl}/api/muestras/${selectedPoint.idMuestra}`,
                        { headers: config.headers }
                    );
                    toast('success', 'Lote eliminado');
                    setSelectedPoint(null);
                    setPuntoProbetas([]);
                } catch (err) {
                    toast('error', err.response?.data?.error || 'Error al eliminar el lote');
                }
            },
        });
    };

    const fetchPuntoProbetas = async (idMuestra) => {
        setLoadingPunto(true);
        setPuntoProbetas([]);
        try {
            const { data } = await axios.get(
                `${config.backendUrl}/api/muestras/${idMuestra}`,
                { headers: config.headers }
            );
            setPuntoProbetas(data?.probetas || []);
        } catch (err) {
            // Sprint 5 M1: catch ya no es silencioso.
            console.error('[RevisionEnsayoPage] fetchPuntoProbetas:', err);
            toast('error', 'No se pudieron cargar las probetas del punto seleccionado.');
            setPuntoProbetas([]);
        } finally {
            setLoadingPunto(false);
        }
    };

    const infoRow = (label, value) => (
        <div className="flex justify-content-between py-1 px-2">
            <span className="text-500">{label}</span>
            <span className="font-semibold">{value || '-'}</span>
        </div>
    );

    if (loading) {
        return (
            <div className="flex justify-content-center align-items-center" style={{ minHeight: 400 }}>
                <ProgressSpinner />
            </div>
        );
    }

    if (!ensayo) {
        return (
            <Fade triggerOnce>
                <PageHeader icon="fa-solid fa-clipboard-check" title="Ensayo no encontrado" subtitle="" />
            </Fade>
        );
    }

    return (
        <>
        <Fade triggerOnce>
            <PageHeader
                icon="fa-solid fa-clipboard-check"
                title={`Revisión - ${probeta?.nombre || probeta?.codigo || 'Ensayo'}`}
                subtitle={`${dosificacionNombre || tipoHormigon} | Remito: ${despacho?.remito || muestraTerceros?.remito || '-'}`}
            />

            <div className="grid">
                {/* ─── Columna izquierda: Info probeta + cumplimiento + hermanas ─── */}
                <div className="col-12 lg:col-4">
                    {/* Indicador de cumplimiento */}
                    <div className="surface-card border-round shadow-1 p-3 mb-3">
                        <div className="flex justify-content-around text-center gap-2">
                            <div>
                                <div className="text-500 text-sm mb-2">Resistencia obtenida</div>
                                <Tag
                                    severity={color ? severityMap[color] : 'info'}
                                    className="px-3 py-2"
                                    style={{ fontSize: '1.4rem', ...(color ? { background: colorHex[color] } : {}) }}
                                    value={resistencia ? `${Number(resistencia).toFixed(1)} MPa` : '- MPa'}
                                />
                            </div>
                            <div>
                                <div className="text-500 text-sm mb-2">Resistencia objetivo</div>
                                <Tag
                                    severity="info"
                                    className="px-3 py-2"
                                    style={{ fontSize: '1.4rem' }}
                                    value={meta ? `${meta} MPa` : (resObjetivo ? `${resObjetivo} MPa` : '- MPa')}
                                />
                            </div>
                        </div>
                        {resistencia && resObjetivo ? (() => {
                            const metaVal = meta ? Number(meta) : resObjetivo;
                            const pct = ((resistencia / metaVal) * 100).toFixed(0);
                            const diagColor = color === 'green' ? '#22c55e' : color === 'orange' ? '#f59e0b' : color === 'red' ? '#ef4444' : null;
                            return (
                                <div className="text-center mt-3">
                                    {meta && (
                                        <div className="text-sm text-500 mb-1">
                                            {Math.round((factor || 1) * 100)}% de {resObjetivo} MPa (edad {ensayo?.edadEnsayo} días)
                                        </div>
                                    )}
                                    {!meta && ensayo?.edadEnsayo && (
                                        <div className="text-sm text-500 mb-1">
                                            Edad ensayo: {ensayo.edadEnsayo} días | Objetivo base: {resObjetivo} MPa
                                        </div>
                                    )}
                                    {diagColor ? (
                                        <>
                                            {color === 'green' && (
                                                <span className="font-semibold" style={{ color: diagColor }}>
                                                    <i className="fa-solid fa-circle-check mr-1" />Cumple ({pct}% de la meta)
                                                </span>
                                            )}
                                            {color === 'orange' && (
                                                <span className="font-semibold" style={{ color: diagColor }}>
                                                    <i className="fa-solid fa-triangle-exclamation mr-1" />Ligeramente por debajo ({pct}% de la meta)
                                                </span>
                                            )}
                                            {color === 'red' && (
                                                <span className="font-semibold" style={{ color: diagColor }}>
                                                    <i className="fa-solid fa-circle-xmark mr-1" />No cumple ({pct}% de la meta)
                                                </span>
                                            )}
                                        </>
                                    ) : (
                                        <span className="font-semibold text-500">
                                            <i className="fa-solid fa-info-circle mr-1" />
                                            {resistencia >= resObjetivo
                                                ? `Alcanza el objetivo (${pct}%)`
                                                : `Por debajo del objetivo (${pct}%)`}
                                        </span>
                                    )}
                                </div>
                            );
                        })() : null}
                    </div>

                    {/* Info de la probeta */}
                    <div className="surface-card border-round shadow-1 p-4 mb-3">
                        <h4 className="mt-0 mb-3">
                            <i className="fa-solid fa-vial mr-2" />
                            Información de la probeta
                        </h4>
                        {infoRow('Probeta', probeta?.nombre || probeta?.codigo)}
                        {infoRow('Dosificación', dosificacionNombre || tipoHormigon)}
                        {infoRow('Edad diseño', edadDisenio ? `${edadDisenio} días` : null)}
                        {infoRow('Edad ensayo', ensayo?.edadEnsayo ? `${ensayo.edadEnsayo} días` : null)}
                        {infoRow('Remito', despacho?.remito || muestraTerceros?.remito)}
                        {infoRow('Fecha confección', despacho?.fecha ? formatDateDMY(despacho.fecha) : muestraTerceros?.fecha ? formatDateDMY(muestraTerceros.fecha) : null)}
                        {infoRow('Planta', despacho?.planta?.nombre || muestraTerceros?.planta?.nombre)}
                        {infoRow('Cliente', despacho?.cliente?.razonSocial || despacho?.cliente?.nombre || muestraTerceros?.cliente?.razonSocial || muestraTerceros?.cliente?.nombre)}
                        {infoRow('Obra', despacho?.obra?.nombre || muestraTerceros?.obra?.nombre)}
                    </div>

                    {/* Hermanas */}
                    {hermanas.length > 0 && (
                        <div className="surface-card border-round shadow-1 p-4">
                            <h4 className="mt-0 mb-3">
                                <i className="fa-solid fa-vials mr-2" />
                                Probetas hermanas ({hermanas.length})
                            </h4>
                            <DataTable responsiveLayout="scroll" value={hermanas} size="small" stripedRows>
                                <Column header="Probeta" body={(h) => h.nombre || h.codigo || '-'} />
                                <Column header="Edad" body={(h) => h.diasRotura ? `${h.diasRotura} d` : '-'} />
                                <Column header="Estado" body={(h) => h.estadoProbeta?.estado || '-'} />
                                <Column header="Resistencia" body={(h) => {
                                    if (!h.ensayo?.resistencia) return '-';
                                    const r = Number(h.ensayo.resistencia);
                                    const c = getColorCumplimiento(r, resObjetivo, h.ensayo?.edadEnsayo || h.diasRotura, edadDisenio);
                                    return (
                                        <Tag
                                            severity={c ? severityMap[c] : 'info'}
                                            value={`${r.toFixed(1)} MPa`}
                                        />
                                    );
                                }} />
                            </DataTable>
                        </div>
                    )}
                </div>

                {/* ─── Columna derecha: Formulario + historial ─── */}
                <div className="col-12 lg:col-8">
                    {/* Formulario editable */}
                    <div className="surface-card border-round shadow-1 p-4 mb-3">
                        <h4 className="mt-0 mb-3">
                            <i className="fa-solid fa-pen-to-square mr-2" />
                            Datos del ensayo
                        </h4>
                        <div className="grid">
                            <div className="col-6 md:col-4 lg:col-3">
                                <label className="block text-sm mb-1">Peso (kg)</label>
                                <InputNumber value={peso} onValueChange={(e) => setPeso(e.value)} inputClassName="w-full"
                                    minFractionDigits={1} maxFractionDigits={4} className="w-full" disabled={!puedeEditar} />
                            </div>
                            <div className="col-6 md:col-4 lg:col-3">
                                <label className="block text-sm mb-1">Altura (mm)</label>
                                <InputNumber value={altura} onValueChange={(e) => setAltura(e.value)} inputClassName="w-full"
                                    minFractionDigits={1} maxFractionDigits={2} className="w-full" disabled={!puedeEditar} />
                            </div>
                            <div className="col-6 md:col-4 lg:col-3">
                                <label className="block text-sm mb-1">Diámetro (mm)</label>
                                <InputNumber value={diametro} onValueChange={(e) => setDiametro(e.value)} inputClassName="w-full"
                                    minFractionDigits={1} maxFractionDigits={2} className="w-full" disabled={!puedeEditar} />
                            </div>
                            <div className="col-6 md:col-4 lg:col-3">
                                <label className="block text-sm mb-1">Fecha ensayo</label>
                                <Calendar value={fechaEnsayo} onChange={(e) => setFechaEnsayo(e.value)} 
                                    dateFormat="dd/mm/yy" className="w-full" disabled={!puedeEditar} />
                            </div>
                            <div className="col-6 md:col-4 lg:col-3">
                                <label className="block text-sm mb-1">Hora ensayo</label>
                                <InputText value={horaEnsayo} onChange={(e) => setHoraEnsayo(e.target.value)} inputClassName="w-full"
                                    placeholder="HH:MM" className="w-full" disabled={!puedeEditar} />
                            </div>
                            <div className="col-12 md:col-6">
                                <label className="block text-sm mb-1">Operario</label>
                                <Dropdown value={idOperarioEnsayo} options={operarios}
                                    onChange={(e) => setIdOperarioEnsayo(e.value)}
                                    filter placeholder="Seleccionar" className="w-full" disabled={!puedeEditar} />
                            </div>
                            {/* Fase 2 Laboratorio (2026-05-12): snapshot del laboratorio
                                donde se ejecutó el ensayo. Read-only: el lab queda frozen
                                al momento del create por el hook beforeCreate. Si el
                                ensayo es legacy o el equipo no tenía lab asignado al crear,
                                el snapshot es null y mostramos '—' (no es un error). */}
                            <div className="col-12 md:col-6">
                                <label className="block text-sm mb-1">
                                    <i className="fa-solid fa-flask-vial mr-1 text-color-secondary" />
                                    Laboratorio
                                </label>
                                <InputText
                                    value={ensayo?.laboratorio?.nombre || '—'}
                                    disabled
                                    className="w-full"
                                    tooltip="Snapshot del laboratorio donde se ejecutó el ensayo. No editable."
                                    tooltipOptions={{ position: 'top' }}
                                />
                            </div>
                            <div className="col-12 md:col-6">
                                <label className="block text-sm mb-1">Prensa</label>
                                <Dropdown value={idPrensa} options={prensasOpts}
                                    onChange={(e) => setIdPrensa(e.value)}
                                    filter placeholder="Seleccionar" className="w-full" disabled={!puedeEditar} />
                                {/* Sprint 5 M3 (sesión 2026-05-10): aviso de
                                    calibración del equipo. Si el revisor cambia
                                    a una prensa sin calibración vigente, debe
                                    saberlo antes de firmar (ISO 17025 §6.4.7).
                                    Mismo patrón que ensayoForm commit 63f46181. */}
                                {(() => {
                                    const p = prensasRaw.find((x) => x.idPrensa === idPrensa);
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
                                                        Si firma este ensayo quedará con trazabilidad débil
                                                        (ISO 17025 §6.4.7).
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
                                                        Si firma este ensayo quedará con trazabilidad débil
                                                        (ISO 17025 §6.4.7).
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
                                                    </span>
                                                }
                                            />
                                        );
                                    }
                                    return null;
                                })()}
                            </div>
                            <div className="col-6 md:col-4 lg:col-3">
                                <label className="block text-sm mb-1">Divisor</label>
                                <InputNumber value={lecturaPrensa} onValueChange={(e) => setLecturaPrensa(e.value)} inputClassName="w-full"
                                    minFractionDigits={2} className="w-full" disabled={!puedeEditar || !idPrensa} />
                            </div>
                            <div className="col-6 md:col-4 lg:col-3">
                                <label className="block text-sm mb-1">Resistencia (MPa)</label>
                                <InputNumber value={resistencia} inputClassName="w-full"
                                    minFractionDigits={2} suffix=" MPa" className="w-full" disabled />
                            </div>
                            <div className="col-12">
                                <label className="block text-sm mb-1">Observaciones</label>
                                <InputTextarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} inputClassName="w-full"
                                    rows={3} className="w-full" disabled={!puedeEditar} />
                            </div>
                        </div>

                        {/* Botones de acción: aprobar (si pendiente) o desaprobar (Mej-17 — si aprobado) */}
                        <div className="flex justify-content-end gap-2 mt-4">
                            {ensayo?.pendienteRevision && puedeAprobar && (
                                <Button
                                    label="Aprobar ensayo"
                                    icon="fa-solid fa-check"
                                    severity="success"
                                    size="small"
                                    onClick={handleAprobar}
                                    loading={saving}
                                    disabled={saving}
                                />
                            )}
                            {!ensayo?.pendienteRevision && puedeDesaprobar && (
                                <Button
                                    label="Desaprobar"
                                    icon="fa-solid fa-rotate-left"
                                    severity="warning"
                                    size="small"
                                    outlined
                                    onClick={handleDesaprobar}
                                    tooltip="Revierte la aprobación. Quedará registrado con motivo, fecha y firma."
                                    tooltipOptions={{ position: 'top' }}
                                />
                            )}
                        </div>
                    </div>

                    {/* Historial de la dosificación */}
                    {chartData && (
                        <div className="surface-card border-round shadow-1 p-3 pb-2">
                            <h4 className="mt-0 mb-2">
                                <i className="fa-solid fa-chart-line mr-2" />
                                Historial de resistencia - {dosificacionNombre || tipoHormigon}
                            </h4>
                            <PrimeChart type="line" data={chartData} options={chartOptions}
                                style={{ height: 'clamp(160px, 30vh, 220px)' }} />
                        </div>
                    )}
                </div>
            </div>
        </Fade>

            {/* Dialog: probetas del punto del historial */}
            <Dialog
                visible={!!selectedPoint}
                onHide={() => { setSelectedPoint(null); setPuntoProbetas([]); }}
                header={
                    selectedPoint ? (
                        <div>
                            <div className="font-bold">
                                Lote del {formatDateDMY(selectedPoint.fechaToma)}
                            </div>
                            <div className="text-sm text-500 font-normal mt-1">
                                {selectedPoint.remito && `Remito: ${selectedPoint.remito} · `}
                                {selectedPoint.obra && `${selectedPoint.obra} · `}
                                {selectedPoint.cliente && selectedPoint.cliente}
                            </div>
                        </div>
                    ) : ''
                }
                style={{ width: '780px' }}
                modal
                dismissableMask
                footer={
                    <div className="flex justify-content-between align-items-center">
                        <div className="text-500 text-sm">Acciones del lote</div>
                        <div className="flex gap-2">
                            <Button
                                label="Editar lote"
                                icon="fa-solid fa-pen-to-square"
                                size="small"
                                outlined
                                onClick={() => {
                                    const idMuestra = selectedPoint?.idMuestra;
                                    setSelectedPoint(null);
                                    navigate(`/calidad/ensayos/muestras/editar/${idMuestra}`);
                                }}
                            />
                            <Button
                                label="Eliminar lote"
                                icon="fa-solid fa-trash"
                                size="small"
                                severity="danger"
                                outlined
                                onClick={handleDeleteLote}
                            />
                        </div>
                    </div>
                }
            >
                {loadingPunto ? (
                    <div className="flex justify-content-center py-4">
                        <ProgressSpinner style={{ width: 40, height: 40 }} />
                    </div>
                ) : (
                    <>
                        {selectedPoint && (
                            <div className="flex gap-4 mb-3 text-sm text-500">
                                <span>
                                    <i className="fa-solid fa-chart-simple mr-1" />
                                    Resistencia promedio:{' '}
                                    <strong className="text-color">
                                        {selectedPoint.resistenciaPromedio?.toFixed(1)} MPa
                                    </strong>
                                </span>
                                {selectedPoint.planta && (
                                    <span>
                                        <i className="fa-solid fa-industry mr-1" />
                                        {selectedPoint.planta}
                                    </span>
                                )}
                            </div>
                        )}
                        <DataTable responsiveLayout="scroll"
                            value={puntoProbetas}
                            size="small"
                            stripedRows
                            emptyMessage="Sin probetas"
                        >
                            <Column
                                header="Probeta"
                                body={(p) => <span className="font-semibold">{p.nombre || p.codigo || '-'}</span>}
                            />
                            <Column
                                header="Días"
                                body={(p) => p.diasRotura ? `${p.diasRotura} d` : '-'}
                            />
                            <Column
                                header="Estado"
                                body={(p) => p.estadoProbeta?.estado || '-'}
                            />
                            <Column
                                header="Resistencia"
                                body={(p) => {
                                    if (!p.ensayo?.resistencia) return <span className="text-400">Sin ensayo</span>;
                                    const r = Number(p.ensayo.resistencia);
                                    const c = getColorCumplimiento(r, resObjetivo, p.ensayo.edadEnsayo || p.diasRotura, edadDisenio);
                                    return (
                                        <Tag
                                            severity={c ? severityMap[c] : 'info'}
                                            value={`${r.toFixed(1)} MPa`}
                                        />
                                    );
                                }}
                            />
                            <Column
                                header="Operario"
                                body={(p) => p.ensayo?.operarioEnsayo
                                    ? `${p.ensayo.operarioEnsayo.apellido}, ${p.ensayo.operarioEnsayo.nombre}`
                                    : '-'}
                            />
                            <Column
                                header=""
                                body={(p) => (
                                    <div className="flex gap-1">
                                        {p.ensayo?.pendienteRevision && (
                                            <Button
                                                icon="fa-solid fa-clipboard-check"
                                                size="small"
                                                severity="warning"
                                                rounded
                                                tooltip="Revisar ensayo"
                                                onClick={() => {
                                                    setSelectedPoint(null);
                                                    navigate(`/calidad/revisiones-ensayos/revisar/${p.ensayo.idEnsayoResistencia}`);
                                                }}
                                            />
                                        )}
                                        <Button
                                            icon="fa-solid fa-pen-to-square"
                                            size="small"
                                            rounded
                                            text
                                            tooltip="Editar probeta"
                                            onClick={() => navigate(`/calidad/ensayos/probetas/editar/${p.idProbeta}`)}
                                        />
                                        <Button
                                            icon="fa-solid fa-trash"
                                            size="small"
                                            severity="danger"
                                            rounded
                                            text
                                            tooltip="Eliminar probeta"
                                            onClick={() => handleDeleteProbeta(p)}
                                        />
                                    </div>
                                )}
                            />
                        </DataTable>
                    </>
                )}
            </Dialog>

            {/* C-SEC-04 / Mej-17 — modal con motivo para aprobar con cambios o desaprobar */}
            <MotivoDialog
                visible={!!motivoDialog}
                onHide={() => setMotivoDialog(null)}
                onConfirm={onMotivoConfirm}
                title={motivoDialog?.mode === 'desaprobar' ? 'Desaprobar ensayo' : 'Confirmar cambios'}
                icon={motivoDialog?.mode === 'desaprobar' ? 'fa-solid fa-rotate-left' : 'fa-solid fa-pen-to-square'}
                severity="warning"
                confirmLabel={motivoDialog?.mode === 'desaprobar' ? 'Desaprobar' : 'Aprobar con cambios'}
                mensaje={
                    motivoDialog?.mode === 'desaprobar' ? (
                        <span>
                            Vas a <strong>revertir la aprobación</strong> de este ensayo. Volverá a la cola de revisión
                            y se registrará tu nombre + fecha + motivo.
                        </span>
                    ) : (
                        <span>
                            Detectamos cambios respecto a los valores cargados originalmente.
                            Para aprobar con esos ajustes hace falta dejar un <strong>motivo</strong> que quede
                            asentado en el historial.
                        </span>
                    )
                }
                extraInfo={
                    motivoDialog?.mode === 'aprobar' && Array.isArray(motivoDialog?.diffs) && motivoDialog.diffs.length > 0 ? (
                        <div>
                            <div className="font-semibold mb-1">Campos modificados:</div>
                            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                                {motivoDialog.diffs.map((d) => (
                                    <li key={d.campo}>
                                        <strong>{d.campo}</strong>: {String(d.original ?? '-')} → {String(d.propuesto ?? '-')}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null
                }
            />
        </>
    );
}
