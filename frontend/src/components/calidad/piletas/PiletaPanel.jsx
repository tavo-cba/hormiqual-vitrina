import React, { useEffect, useState, useCallback, useRef, useMemo, useContext } from "react";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { Calendar } from "primereact/calendar";
import { Fade } from "react-awesome-reveal";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Chart as PrimeChart } from "primereact/chart";
import "chart.js/auto";
import { config } from "../../../config/config";
import { useToast } from "../../../context/ToastContext";
import { ThemeContext } from "../../../context/ThemeContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import "./PiletaPanel.css";

// Mínimo de tramos medidos para considerar confiable un bucket de la correlación sala↔resistencias.
// Cada tramo ≈ un intervalo entre lecturas (~30 min). 5 tramos ≈ 2.5 hs reales en ese rango.
const MIN_MUESTRAS_CORRELACION = 5;

const MODOS_BOMBAS = [
    { label: "Continuo", value: "continuo" },
    { label: "Por intervalos", value: "intervalos" },
    { label: "Emparejado con resistencias", value: "emparejado" },
];

const PERIODOS_CONSUMO = [
    { label: "Hoy", value: "hoy" },
    { label: "Esta semana", value: "semana" },
    { label: "Este mes", value: "mes" },
    { label: "Mes pasado", value: "mes_anterior" },
    { label: "Personalizado", value: "personalizado" },
];

const LABELS_COMANDO = {
    toggle_bombas: "Toggle bombas",
    toggle_resistencias: "Toggle resistencias",
    set_temperatura_objetivo: "Cambiar temperatura objetivo",
    set_tolerancia_temp: "Cambiar tolerancia",
    set_resistencias_modo: "Cambiar modo resistencias",
    set_bombas_config: "Cambiar config bombas",
};

function getPeriodoFechas(periodo) {
    const ahora = new Date();
    let desde, hasta;
    if (periodo === "hoy") {
        desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
        hasta = ahora;
    } else if (periodo === "semana") {
        const dia = ahora.getDay();
        const diff = ahora.getDate() - dia + (dia === 0 ? -6 : 1);
        desde = new Date(ahora.setDate(diff));
        desde.setHours(0, 0, 0, 0);
        hasta = new Date();
    } else if (periodo === "mes") {
        desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        hasta = ahora;
    } else if (periodo === "mes_anterior") {
        desde = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
        hasta = new Date(ahora.getFullYear(), ahora.getMonth(), 0, 23, 59, 59);
    }
    return { desde, hasta };
}

function formatHoras(seg) {
    if (!seg) return "0h 0min";
    const h = Math.floor(seg / 3600);
    const m = Math.floor((seg % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function formatMoney(val) {
    if (!val) return "$0";
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(val);
}

function formatHora(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatFechaCorta(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const PiletaPanel = () => {
    const { id } = useParams();
    const toast = useToast();

    const [pileta, setPileta] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Temperatura edición
    const [editTemp, setEditTemp] = useState(false);
    const [tempObjetivo, setTempObjetivo] = useState(null);
    const [toleranciaTemp, setToleranciaTemp] = useState(null);
    const [savingTemp, setSavingTemp] = useState(false);

    // Bombas config
    const [editBombas, setEditBombas] = useState(false);
    const [modoBombas, setModoBombas] = useState("continuo");
    const [minutosOn, setMinutosOn] = useState(30);
    const [minutosOff, setMinutosOff] = useState(15);
    const [minutosDelay, setMinutosDelay] = useState(5);
    const [savingBombas, setSavingBombas] = useState(false);

    // Acciones individuales
    const [sendingCmd, setSendingCmd] = useState({});

    // Consumo
    const [periodo, setPeriodo] = useState("mes");
    const [desdePersonalizado, setDesdePersonalizado] = useState(null);
    const [hastaPersonalizado, setHastaPersonalizado] = useState(null);
    const [consumo, setConsumo] = useState(null);
    const [loadingConsumo, setLoadingConsumo] = useState(false);

    // Comandos
    const [comandos, setComandos] = useState([]);

    // Gráfico temperatura histórica
    const [periodoTemp, setPeriodoTemp] = useState("hoy");
    const [tempData, setTempData] = useState([]);
    const [loadingTemp, setLoadingTemp] = useState(false);

    // Ciclos de resistencias (para sombrear el gráfico) + correlación con temp ambiente
    const [resistenciasOn, setResistenciasOn] = useState([]);
    const [correlacion, setCorrelacion] = useState(null);

    // Toggles del usuario para mostrar/ocultar las series adicionales
    const [showAmbiente, setShowAmbiente] = useState(true);
    const [showRango, setShowRango] = useState(true);
    const [showResistenciasOverlay, setShowResistenciasOverlay] = useState(true);

    const { isDark } = useContext(ThemeContext);

    const refreshRef = useRef(null);

    const fetchPileta = useCallback(async (showSpinner = false) => {
        if (showSpinner) setRefreshing(true);
        try {
            const { data } = await axios.get(`${config.backendUrl}/api/piletas/${id}`, { headers: config.headers });
            setPileta(data);
            // Sincronizar estado de edición con datos frescos
            const cfg = data.estado?.labInfo?.config;
            if (cfg) {
                setModoBombas(cfg.bombas?.modo || "continuo");
                setMinutosOn(cfg.bombas?.minutosOn || 30);
                setMinutosOff(cfg.bombas?.minutosOff || 15);
                setMinutosDelay(cfg.bombas?.minutosDelayApagado || 5);
                setTempObjetivo(cfg.temperaturaObjetivo ?? data.estado?.temperaturaObjetivo ?? null);
                setToleranciaTemp(cfg.toleranciaTemp ?? 1.5);
            } else {
                setTempObjetivo(data.estado?.temperaturaObjetivo ?? null);
            }
        } catch {
            toast("error", "No se pudo cargar la pileta");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [id]);

    const fetchComandos = useCallback(async () => {
        try {
            const { data } = await axios.get(`${config.backendUrl}/api/piletas/${id}/comandos`, { headers: config.headers });
            setComandos(data);
        } catch { /* silencioso */ }
    }, [id]);

    useEffect(() => {
        fetchPileta(false);
        fetchComandos();
        refreshRef.current = setInterval(() => {
            fetchPileta(false);
            fetchComandos();
        }, 30000);
        return () => clearInterval(refreshRef.current);
    }, [fetchPileta, fetchComandos]);

    const fetchConsumo = useCallback(async () => {
        setLoadingConsumo(true);
        try {
            let desde, hasta;
            if (periodo === "personalizado") {
                if (!desdePersonalizado || !hastaPersonalizado) {
                    setLoadingConsumo(false);
                    return;
                }
                desde = desdePersonalizado.toISOString();
                hasta = hastaPersonalizado.toISOString();
            } else {
                const fechas = getPeriodoFechas(periodo);
                desde = fechas.desde.toISOString();
                hasta = fechas.hasta.toISOString();
            }
            const { data } = await axios.get(`${config.backendUrl}/api/piletas/${id}/consumo`, {
                headers: config.headers,
                params: { desde, hasta },
            });
            setConsumo(data);
        } catch {
            toast("error", "Error al calcular consumo");
        } finally {
            setLoadingConsumo(false);
        }
    }, [id, periodo, desdePersonalizado, hastaPersonalizado]);

    useEffect(() => {
        fetchConsumo();
    }, [fetchConsumo]);

    const enviarComando = async (tipo, payload, key) => {
        setSendingCmd(prev => ({ ...prev, [key]: true }));
        try {
            await axios.post(`${config.backendUrl}/api/piletas/${id}/comandos`, { tipo, payload }, { headers: config.headers });
            toast("success", "Comando enviado. Se aplicará en ~5 segundos.");
            fetchComandos();
        } catch {
            toast("error", "Error al enviar comando");
        } finally {
            setSendingCmd(prev => ({ ...prev, [key]: false }));
        }
    };

    const guardarTemperatura = async () => {
        setSavingTemp(true);
        const cmds = [];
        if (tempObjetivo != null) cmds.push(enviarComando("set_temperatura_objetivo", { temperatura: tempObjetivo }, "temp_obj"));
        if (toleranciaTemp != null) cmds.push(enviarComando("set_tolerancia_temp", { tolerancia: toleranciaTemp }, "temp_tol"));
        await Promise.all(cmds);
        setSavingTemp(false);
        setEditTemp(false);
    };

    const guardarConfigBombas = async () => {
        setSavingBombas(true);
        await enviarComando("set_bombas_config", {
            modo: modoBombas,
            minutosOn,
            minutosOff,
            minutosDelayApagado: minutosDelay,
        }, "bombas_config");
        setSavingBombas(false);
        setEditBombas(false);
    };

    const fetchTemperaturas = useCallback(async () => {
        setLoadingTemp(true);
        try {
            const { desde, hasta } = getPeriodoFechas(periodoTemp);
            const params = { desde: desde.toISOString(), hasta: hasta.toISOString() };
            const [{ data: temp }, { data: onRanges }, { data: corr }] = await Promise.all([
                axios.get(`${config.backendUrl}/api/piletas/${id}/temperatura`, { headers: config.headers, params }),
                axios.get(`${config.backendUrl}/api/piletas/${id}/resistencias-on`, { headers: config.headers, params }),
                axios.get(`${config.backendUrl}/api/piletas/${id}/correlacion-ambiente`, { headers: config.headers, params }),
            ]);
            setTempData(temp);
            setResistenciasOn(onRanges || []);
            setCorrelacion(corr || null);
        } catch {
            toast("error", "Error al cargar temperaturas");
        } finally {
            setLoadingTemp(false);
        }
    }, [id, periodoTemp]);

    useEffect(() => {
        fetchTemperaturas();
    }, [fetchTemperaturas]);

    const tempChartData = useMemo(() => {
        if (!tempData?.length) return null;
        const textColor = isDark ? "#e2e8f0" : "#374151";
        const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
        const cfg = pileta?.estado?.labInfo?.config;
        const objetivo = cfg?.temperaturaObjetivo ?? pileta?.estado?.temperaturaObjetivo;
        const tolerancia = cfg?.toleranciaTemp ?? 1.5;

        const isHoy = periodoTemp === "hoy";
        const labels = tempData.map(r => {
            const d = new Date(r.timestamp);
            return isHoy
                ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
                : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
        });
        const tooltipLabels = tempData.map(r =>
            new Date(r.timestamp).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        );
        const timestampsMs = tempData.map(r => new Date(r.timestamp).getTime());

        const pts = tempData.length;
        const datasets = [
            {
                label: "Temperatura",
                data: tempData.map(r => parseFloat(r.temperatura)),
                borderColor: "#3b82f6",
                backgroundColor: "rgba(59,130,246,0.08)",
                fill: true,
                tension: 0.35,
                pointRadius: pts > 150 ? 0 : pts > 50 ? 2 : 3,
                borderWidth: 2,
                yAxisID: 'y',
            },
        ];

        if (objetivo != null) {
            datasets.push({
                label: `Objetivo (${objetivo}°C)`,
                data: tempData.map(() => objetivo),
                borderColor: "#10b981",
                borderDash: [6, 3],
                pointRadius: 0,
                fill: false,
                borderWidth: 1.5,
                yAxisID: 'y',
            });
            datasets.push({
                label: `+${tolerancia}°C`,
                data: tempData.map(() => objetivo + tolerancia),
                borderColor: "rgba(239,68,68,0.4)",
                borderDash: [3, 3],
                pointRadius: 0,
                fill: false,
                borderWidth: 1,
                yAxisID: 'y',
            });
            datasets.push({
                label: `-${tolerancia}°C`,
                data: tempData.map(() => objetivo - tolerancia),
                borderColor: "rgba(239,68,68,0.4)",
                borderDash: [3, 3],
                pointRadius: 0,
                fill: false,
                borderWidth: 1,
                yAxisID: 'y',
            });
        }

        // Sala de curado (temperatura ambiente) — eje izquierdo
        const ambienteValores = tempData.map(r => r.temperaturaAmbiente != null ? parseFloat(r.temperaturaAmbiente) : null);
        const hayAmbiente = ambienteValores.some(v => v != null);
        if (hayAmbiente && showAmbiente) {
            datasets.push({
                label: "Sala de curado",
                data: ambienteValores,
                borderColor: "#f59e0b",
                backgroundColor: "rgba(245,158,11,0.05)",
                borderDash: [2, 2],
                pointRadius: 0,
                fill: false,
                borderWidth: 1.5,
                yAxisID: 'y',
                spanGaps: true,
            });
        }

        // Rango entre sensores — eje derecho (0..max)
        const rangoValores = tempData.map(r => r.rangoTemp != null ? parseFloat(r.rangoTemp) : null);
        const hayRango = rangoValores.some(v => v != null && v > 0);
        if (hayRango && showRango) {
            datasets.push({
                label: "Δ entre sensores",
                data: rangoValores,
                borderColor: "#a855f7",
                backgroundColor: "rgba(168,85,247,0.08)",
                pointRadius: 0,
                fill: true,
                borderWidth: 1.2,
                yAxisID: 'yRango',
                spanGaps: true,
            });
        }

        // Plugin custom: sombrea las bandas de tiempo en las que las resistencias estuvieron prendidas.
        // Mapea timestamps a posiciones x usando getPixelForValue sobre los índices.
        const resistenciasOnRanges = showResistenciasOverlay ? resistenciasOn : [];
        const overlayResistenciasPlugin = {
            id: 'overlayResistencias',
            beforeDatasetsDraw(chart) {
                if (!resistenciasOnRanges.length || !timestampsMs.length) return;
                const { ctx, chartArea, scales } = chart;
                if (!chartArea || !scales.x) return;
                const tsMin = timestampsMs[0];
                const tsMax = timestampsMs[timestampsMs.length - 1];

                // Para un timestamp ms cualquiera, devuelve la posición x en píxeles
                // interpolando entre los índices más cercanos.
                const xForTs = (ts) => {
                    if (ts <= tsMin) return scales.x.getPixelForValue(0);
                    if (ts >= tsMax) return scales.x.getPixelForValue(timestampsMs.length - 1);
                    // binary-search del índice inferior
                    let lo = 0, hi = timestampsMs.length - 1;
                    while (lo < hi - 1) {
                        const mid = (lo + hi) >> 1;
                        if (timestampsMs[mid] <= ts) lo = mid; else hi = mid;
                    }
                    const t0 = timestampsMs[lo];
                    const t1 = timestampsMs[hi];
                    const frac = t1 === t0 ? 0 : (ts - t0) / (t1 - t0);
                    const x0 = scales.x.getPixelForValue(lo);
                    const x1 = scales.x.getPixelForValue(hi);
                    return x0 + (x1 - x0) * frac;
                };

                ctx.save();
                ctx.fillStyle = isDark ? "rgba(239,68,68,0.10)" : "rgba(239,68,68,0.08)";
                for (const r of resistenciasOnRanges) {
                    const ini = new Date(r.inicio).getTime();
                    const fin = r.fin ? new Date(r.fin).getTime() : Date.now();
                    // Recortar al rango visible
                    if (fin < tsMin || ini > tsMax) continue;
                    const xa = xForTs(Math.max(ini, tsMin));
                    const xb = xForTs(Math.min(fin, tsMax));
                    const w = Math.max(1, xb - xa);
                    ctx.fillRect(xa, chartArea.top, w, chartArea.bottom - chartArea.top);
                }
                ctx.restore();
            },
        };

        return {
            data: { labels, datasets },
            plugins: [overlayResistenciasPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { labels: { color: textColor, boxWidth: 10, font: { size: 10 } } },
                    tooltip: {
                        callbacks: {
                            title: (items) => tooltipLabels[items[0]?.dataIndex] || "",
                            label: (ctx) => {
                                if (ctx.parsed.y == null) return null;
                                const sufijo = ctx.dataset.yAxisID === 'yRango' ? '°C (Δ)' : '°C';
                                return `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}${sufijo}`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: { color: textColor, maxRotation: 45, font: { size: 10 }, maxTicksLimit: 12 },
                        grid: { color: gridColor },
                    },
                    y: {
                        position: 'left',
                        ticks: { color: textColor, callback: (v) => `${v}°C`, font: { size: 10 } },
                        grid: { color: gridColor },
                    },
                    yRango: {
                        position: 'right',
                        display: hayRango && showRango,
                        beginAtZero: true,
                        suggestedMax: 5,
                        ticks: { color: textColor, callback: (v) => `Δ${v}°`, font: { size: 10 } },
                        grid: { drawOnChartArea: false },
                    },
                },
            },
        };
    }, [tempData, periodoTemp, isDark, pileta, resistenciasOn, showAmbiente, showRango, showResistenciasOverlay]);

    if (loading) {
        return <div className="cover-container w-full h-full flex align-self-center justify-content-center"><LoadSpinner /></div>;
    }

    if (!pileta) {
        return <div className="p-4">Pileta no encontrada.</div>;
    }

    const estado = pileta.estado;
    const labCfg = estado?.labInfo?.config;
    const labHw = estado?.labInfo?.hardware;
    const labEventos = estado?.labInfo?.eventos || [];
    const sinConexion = estado?.ultimaActualizacion
        ? Math.floor((Date.now() - new Date(estado.ultimaActualizacion).getTime()) / 60000) > 5
        : !estado;
    const ultimaAct = formatFechaCorta(estado?.ultimaActualizacion);

    const bombasOn = !!estado?.bombasEncendidas;
    const resistOn = !!estado?.resistenciasEncendidas;
    const modoAutoResist = labCfg?.resistencias?.modoAutomatico ?? true;

    const tieneWatts = pileta.wattsResistencias || pileta.wattsBombas;
    const tienePrecio = pileta.precioKwh;

    return (
        <Fade direction="up" duration={400} triggerOnce>
            <div className="pileta-panel">
                {/* Header */}
                <div className="w-full pileta-panel__header">
                    <div>
                        <PageHeader
                            icon="fa-solid fa-sliders"
                            title={`Panel — ${pileta.nombre}`}
                            subtitle={pileta.planta?.nombre ? `Planta: ${pileta.planta.nombre}` : "Sin planta asignada"}
                            className='w-full'
                        />
                    </div>
                    <div className="flex align-items-center gap-2">
                        {sinConexion && (
                            <div className="pileta-panel__sin-conexion">
                                <i className="fa-solid fa-plug-circle-xmark" />
                                Sin conexión con el laboratorio — última actualización: {ultimaAct}
                            </div>
                        )}
                    </div>
                </div>

                <div className="pileta-panel__grid">

                    {/* ── Temperatura ── */}
                    <div className="panel-card">
                        <div className="panel-card__title">
                            <i className="fa-solid fa-thermometer-half" />
                            Temperatura
                        </div>
                        <div className="panel-temp__valores">
                            <div className="panel-temp__actual">
                                {estado?.temperaturaActual != null
                                    ? `${Number(estado.temperaturaActual).toFixed(1)}°C`
                                    : "—"}
                            </div>
                            <div className="panel-temp__fila">
                                <i className="fa-solid fa-bullseye" />
                                <span>Objetivo: <strong>{labCfg?.temperaturaObjetivo ?? estado?.temperaturaObjetivo ?? "—"}°C</strong></span>
                                <span style={{ color: 'var(--surface-border)' }}>|</span>
                                <span>Tolerancia: <strong>±{labCfg?.toleranciaTemp ?? 1.5}°C</strong></span>
                            </div>
                            {(() => {
                                const lecturas = estado?.labInfo?.lecturas || [];
                                const rango = estado?.rangoTemp ?? estado?.labInfo?.rangoTemp ?? null;
                                if (lecturas.length <= 1 && rango == null) return null;
                                return (
                                    <div className="panel-temp__fila" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
                                        <i className="fa-solid fa-temperature-low" style={{ color: 'var(--text-color-secondary)' }} />
                                        <span>
                                            Sensores: <strong>{lecturas.length}</strong>
                                        </span>
                                        {rango != null && (
                                            <>
                                                <span style={{ color: 'var(--surface-border)' }}>|</span>
                                                <span>
                                                    Rango entre sensores: <strong>{Number(rango).toFixed(1)}°C</strong>
                                                </span>
                                            </>
                                        )}
                                        {lecturas.length > 0 && (
                                            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.3rem', marginLeft: '0.3rem' }}>
                                                {lecturas.map(l => (
                                                    <span key={l.sensorId}
                                                        title={l.sensorId}
                                                        style={{
                                                            fontFamily: 'ui-monospace, monospace',
                                                            fontSize: '0.75rem',
                                                            background: 'var(--cover-input-bg)',
                                                            border: '1px solid var(--surface-border)',
                                                            padding: '0.1rem 0.4rem',
                                                            borderRadius: '0.4rem',
                                                        }}>
                                                        {Number(l.temp).toFixed(1)}°
                                                    </span>
                                                ))}
                                            </span>
                                        )}
                                    </div>
                                );
                            })()}
                            {estado?.temperaturaAmbiente != null && (
                                <div className="panel-temp__fila">
                                    <i className="fa-solid fa-house" style={{ color: 'var(--text-color-secondary)' }} />
                                    <span>
                                        Sala de curado: <strong>{Number(estado.temperaturaAmbiente).toFixed(1)}°C</strong>
                                    </span>
                                </div>
                            )}
                        </div>

                        {!editTemp ? (
                            <Button label="Editar temperatura" icon="fa-solid fa-pencil" size="small"
                                outlined onClick={() => setEditTemp(true)} />
                        ) : (
                            <div className="panel-temp__edit">
                                <div className="panel-temp__edit-row">
                                    <label>Temperatura objetivo</label>
                                    <InputNumber value={tempObjetivo} onChange={e => setTempObjetivo(e.value)}
                                        min={0} max={50} minFractionDigits={1} suffix="°C"
                                        inputStyle={{ width: '90px' }} />
                                </div>
                                <div className="panel-temp__edit-row">
                                    <label>Tolerancia</label>
                                    <InputNumber value={toleranciaTemp} onChange={e => setToleranciaTemp(e.value)}
                                        min={0.1} max={10} minFractionDigits={1} prefix="±" suffix="°C"
                                        inputStyle={{ width: '90px' }} />
                                </div>
                                <div className="flex gap-2 mt-1">
                                    <Button label="Aplicar" icon="fa-solid fa-check" size="small"
                                        loading={savingTemp} onClick={guardarTemperatura} />
                                    <Button label="Cancelar" size="small" text severity="secondary"
                                        onClick={() => setEditTemp(false)} />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Resistencias ── */}
                    <div className="panel-card">
                        <div className="panel-card__title">
                            <i className="fa-solid fa-fire" />
                            Resistencias
                        </div>
                        <div className="panel-device">
                            <div className="panel-device__estado">
                                <div className={`panel-device__indicator panel-device__indicator--${resistOn ? "on" : "off"}`} />
                                <span className="panel-device__label">{resistOn ? "Encendidas" : "Apagadas"}</span>
                                <Tag
                                    value={modoAutoResist ? "Automático" : "Manual"}
                                    severity={modoAutoResist ? "info" : "warning"}
                                    icon={modoAutoResist ? "fa-solid fa-robot" : "fa-solid fa-hand"}
                                    style={{ fontSize: '0.72rem' }}
                                />
                            </div>
                            <div className="panel-device__actions">
                                <Button
                                    label={resistOn ? "Apagar" : "Encender"}
                                    icon={`fa-solid fa-${resistOn ? "power-off" : "fire"}`}
                                    size="small" rounded
                                    severity={resistOn ? "danger" : "success"}
                                    loading={!!sendingCmd.toggle_res}
                                    onClick={() => enviarComando("toggle_resistencias", { estado: !resistOn }, "toggle_res")}
                                />
                                <Button
                                    label={modoAutoResist ? "Pasar a manual" : "Pasar a automático"}
                                    icon={`fa-solid fa-${modoAutoResist ? "hand" : "robot"}`}
                                    size="small" rounded outlined
                                    severity="secondary"
                                    loading={!!sendingCmd.modo_res}
                                    onClick={() => enviarComando("set_resistencias_modo", { modoAutomatico: !modoAutoResist }, "modo_res")}
                                />
                            </div>
                            {labCfg?.resistencias?.modoAutomatico && (
                                <span className="panel-device__debounce">
                                    <i className="fa-solid fa-clock-rotate-left" />
                                    En automático, enciende/apaga según temperatura objetivo con tolerancia ±{labCfg?.toleranciaTemp ?? 1.5}°C
                                </span>
                            )}
                        </div>
                    </div>

                    {/* ── Bombas ── */}
                    <div className="panel-card">
                        <div className="panel-card__title">
                            <i className="fa-solid fa-water-ladder" />
                            Bombas
                        </div>
                        <div className="panel-device">
                            <div className="panel-device__estado">
                                <div className={`panel-device__indicator panel-device__indicator--${bombasOn ? "on" : "off"}`} />
                                <span className="panel-device__label">{bombasOn ? "Encendidas" : "Apagadas"}</span>
                                <Tag
                                    value={MODOS_BOMBAS.find(m => m.value === (labCfg?.bombas?.modo || modoBombas))?.label || "Continuo"}
                                    severity="secondary"
                                    style={{ fontSize: '0.72rem' }}
                                />
                            </div>
                            <div className="panel-device__actions">
                                <Button
                                    label={bombasOn ? "Apagar" : "Encender"}
                                    icon="fa-solid fa-power-off"
                                    size="small" rounded
                                    severity={bombasOn ? "danger" : "success"}
                                    loading={!!sendingCmd.toggle_bom}
                                    onClick={() => enviarComando("toggle_bombas", { estado: !bombasOn }, "toggle_bom")}
                                />
                                <Button
                                    label="Configurar ciclo"
                                    icon="fa-solid fa-gears"
                                    size="small" rounded outlined
                                    severity="secondary"
                                    onClick={() => setEditBombas(v => !v)}
                                />
                            </div>

                            {editBombas && (
                                <div className="panel-device__config">
                                    <div className="panel-device__config-row">
                                        <label>Modo</label>
                                        <Dropdown value={modoBombas} onChange={e => setModoBombas(e.value)}
                                            options={MODOS_BOMBAS} style={{ minWidth: '200px' }} />
                                    </div>
                                    {modoBombas === "intervalos" && <>
                                        <div className="panel-device__config-row">
                                            <label>Tiempo encendidas</label>
                                            <InputNumber value={minutosOn} onChange={e => setMinutosOn(e.value)}
                                                min={1} max={1440} suffix=" min" inputStyle={{ width: '80px' }} />
                                        </div>
                                        <div className="panel-device__config-row">
                                            <label>Tiempo apagadas</label>
                                            <InputNumber value={minutosOff} onChange={e => setMinutosOff(e.value)}
                                                min={1} max={1440} suffix=" min" inputStyle={{ width: '80px' }} />
                                        </div>
                                    </>}
                                    {modoBombas === "emparejado" && (
                                        <div className="panel-device__config-row">
                                            <label>Delay de apagado</label>
                                            <InputNumber value={minutosDelay} onChange={e => setMinutosDelay(e.value)}
                                                min={0} max={60} suffix=" min" inputStyle={{ width: '80px' }} />
                                            <small style={{ color: 'var(--text-color-secondary)', fontSize: '0.78rem' }}>
                                                Minutos después de apagarse las resistencias
                                            </small>
                                        </div>
                                    )}
                                    <div className="flex gap-2 mt-1">
                                        <Button label="Aplicar" icon="fa-solid fa-check" size="small"
                                            loading={savingBombas} onClick={guardarConfigBombas} />
                                        <Button label="Cancelar" size="small" text severity="secondary"
                                            onClick={() => setEditBombas(false)} />
                                    </div>
                                </div>
                            )}

                            {(labCfg?.bombas?.modo === "intervalos") && !editBombas && (
                                <span className="panel-device__debounce">
                                    <i className="fa-solid fa-clock" />
                                    {labCfg.bombas.minutosOn} min encendidas / {labCfg.bombas.minutosOff} min apagadas
                                </span>
                            )}
                            {(labCfg?.bombas?.modo === "emparejado") && !editBombas && (() => {
                                const cd = estado?.labInfo?.emparejadoCountdown;
                                if (cd && cd.restanteMs > 0) {
                                    const elapsedMs = estado?.ultimaActualizacion
                                        ? Date.now() - new Date(estado.ultimaActualizacion).getTime()
                                        : 0;
                                    const restanteSeg = Math.max(0, Math.ceil((cd.restanteMs - elapsedMs) / 1000));
                                    const min = Math.floor(restanteSeg / 60);
                                    const seg = restanteSeg % 60;
                                    return (
                                        <span className="panel-device__debounce" style={{ color: '#f59e0b' }}>
                                            <i className="fa-solid fa-hourglass-half" />
                                            Bombas se apagan en {min > 0 ? `${min} min ${seg}s` : `${seg}s`} (resistencias apagadas)
                                        </span>
                                    );
                                }
                                return (
                                    <span className="panel-device__debounce">
                                        <i className="fa-solid fa-link" />
                                        Se apagan {labCfg.bombas.minutosDelayApagado ?? 5} min después de las resistencias
                                    </span>
                                );
                            })()}
                        </div>
                    </div>

                    {/* ── Hardware ── */}
                    <div className="panel-card">
                        <div className="panel-card__title">
                            <i className="fa-solid fa-microchip" />
                            Hardware detectado
                        </div>
                        {labHw ? (
                            <div className="panel-hardware__items">
                                {[
                                    { key: "sensorTemp", label: "Sensor temp." },
                                    { key: "releBombas", label: "Relé bombas" },
                                    { key: "releResistencias", label: "Relé resistencias" },
                                ].map(({ key, label }) => (
                                    <div key={key} className={`panel-hw-item panel-hw-item--${labHw[key] ? "ok" : "fail"}`}>
                                        <i className={`fa-solid fa-circle-${labHw[key] ? "check" : "xmark"}`} />
                                        <span>{label}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <span className="text-500 text-sm">Sin datos de hardware (pendiente primer reporte)</span>
                        )}
                        <div className="text-sm" style={{ color: 'var(--text-color-secondary)' }}>
                            <i className="fa-solid fa-clock mr-1" />
                            Última actualización: {ultimaAct}
                        </div>
                    </div>

                    {/* ── Consumo ── */}
                    <div className="panel-card panel-card__span2">
                        <div className="panel-card__title">
                            <i className="fa-solid fa-bolt" />
                            Consumo eléctrico
                        </div>
                        <div className="panel-consumo__periodos">
                            {PERIODOS_CONSUMO.map(p => (
                                <Button key={p.value} label={p.label} size="small"
                                    outlined={periodo !== p.value}
                                    severity={periodo === p.value ? "info" : "secondary"}
                                    onClick={() => setPeriodo(p.value)} />
                            ))}
                        </div>
                        {periodo === "personalizado" && (
                            <div className="flex gap-3 flex-wrap align-items-center panel-consumo__personalizado">
                                <div className="flex flex-column gap-1 panel-consumo__fecha-col">
                                    <label className="text-sm" style={{ color: 'var(--text-color-secondary)' }}>Desde</label>
                                    <Calendar value={desdePersonalizado} onChange={e => setDesdePersonalizado(e.value)}
                                        showTime hourFormat="24" dateFormat="dd/mm/yy" showIcon className="w-full" />
                                </div>
                                <div className="flex flex-column gap-1 panel-consumo__fecha-col">
                                    <label className="text-sm" style={{ color: 'var(--text-color-secondary)' }}>Hasta</label>
                                    <Calendar value={hastaPersonalizado} onChange={e => setHastaPersonalizado(e.value)}
                                        showTime hourFormat="24" dateFormat="dd/mm/yy" showIcon className="w-full" />
                                </div>
                                <Button label="Calcular" icon="fa-solid fa-calculator" size="small"
                                    onClick={fetchConsumo} className="align-self-end panel-consumo__calc-btn" />
                            </div>
                        )}
                        {loadingConsumo ? (
                            <div className="flex justify-content-center p-3"><LoadSpinner /></div>
                        ) : consumo ? (
                            <>
                                {!tieneWatts && (
                                    <div className="panel-consumo__no-config">
                                        <i className="fa-solid fa-triangle-exclamation" />
                                        Configura los Watts de resistencias y bombas en "Editar pileta" para ver el consumo en kWh.
                                    </div>
                                )}
                                {!tienePrecio && tieneWatts && (
                                    <div className="panel-consumo__no-config">
                                        <i className="fa-solid fa-info-circle" />
                                        Configura el precio del kWh en "Editar pileta" para ver el costo.
                                    </div>
                                )}
                                <div className="panel-consumo__tabla">
                                    {[
                                        {
                                            label: "Resistencias", icon: "fa-solid fa-fire",
                                            seg: consumo.resistencias.segundos,
                                            kwh: consumo.resistencias.kwh,
                                            costo: consumo.resistencias.costo,
                                            watts: consumo.wattsResistencias,
                                        },
                                        {
                                            label: "Bombas", icon: "fa-solid fa-water-ladder",
                                            seg: consumo.bombas.segundos,
                                            kwh: consumo.bombas.kwh,
                                            costo: consumo.bombas.costo,
                                            watts: consumo.wattsBombas,
                                        },
                                    ].map(item => (
                                        <div key={item.label} className="panel-consumo__fila">
                                            <div className="panel-consumo__fila-label">
                                                <i className={item.icon} />
                                                {item.label}
                                                {item.watts > 0 && <span className="ml-1 text-xs">({item.watts} W)</span>}
                                            </div>
                                            <div className="panel-consumo__fila-valores">
                                                <span>{formatHoras(item.seg)}</span>
                                                {item.watts > 0 && <strong>{item.kwh.toFixed(3)} kWh</strong>}
                                                {item.watts > 0 && tienePrecio && <span>{formatMoney(item.costo)}</span>}
                                            </div>
                                        </div>
                                    ))}
                                    <div className="panel-consumo__fila panel-consumo__fila--total">
                                        <div className="panel-consumo__fila-label">
                                            <i className="fa-solid fa-sigma" /> Total
                                        </div>
                                        <div className="panel-consumo__fila-valores">
                                            {tieneWatts && <strong>{consumo.total.kwh.toFixed(3)} kWh</strong>}
                                            {tieneWatts && tienePrecio && <span style={{ fontSize: '1rem', color: 'var(--text-color)' }}>{formatMoney(consumo.total.costo)}</span>}
                                            {!tieneWatts && <span className="text-500">—</span>}
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : null}
                    </div>

                    {/* ── Temperatura histórica ── */}
                    <div className="panel-card panel-card__span2">
                        <div className="panel-card__title">
                            <i className="fa-solid fa-chart-line" />
                            Temperatura histórica
                        </div>
                        <div className="panel-consumo__periodos">
                            {[
                                { label: "Hoy", value: "hoy" },
                                { label: "Esta semana", value: "semana" },
                                { label: "Este mes", value: "mes" },
                                { label: "Mes pasado", value: "mes_anterior" },
                            ].map(p => (
                                <Button key={p.value} label={p.label} size="small"
                                    outlined={periodoTemp !== p.value}
                                    severity={periodoTemp === p.value ? "info" : "secondary"}
                                    onClick={() => setPeriodoTemp(p.value)} />
                            ))}
                        </div>
                        {/* Toggles de series */}
                        <div className="panel-temp-historia__toggles" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', marginTop: '0.4rem', marginBottom: '0.2rem' }}>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-color-secondary)' }}>Mostrar:</span>
                            <Button
                                size="small"
                                outlined={!showAmbiente}
                                severity={showAmbiente ? "warning" : "secondary"}
                                onClick={() => setShowAmbiente(v => !v)}
                                icon="fa-solid fa-house"
                                label="Sala de curado"
                                style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
                            />
                            <Button
                                size="small"
                                outlined={!showRango}
                                severity={showRango ? "help" : "secondary"}
                                onClick={() => setShowRango(v => !v)}
                                icon="fa-solid fa-arrows-up-down"
                                label="Δ entre sensores"
                                style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
                            />
                            <Button
                                size="small"
                                outlined={!showResistenciasOverlay}
                                severity={showResistenciasOverlay ? "danger" : "secondary"}
                                onClick={() => setShowResistenciasOverlay(v => !v)}
                                icon="fa-solid fa-fire"
                                label="Resistencias ON"
                                tooltip="Sombrea los períodos en que estuvieron prendidas las resistencias"
                                tooltipOptions={{ position: 'top' }}
                                style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
                            />
                        </div>
                        {loadingTemp ? (
                            <div className="flex justify-content-center p-3"><LoadSpinner /></div>
                        ) : tempChartData ? (
                            <PrimeChart
                                type="line"
                                data={tempChartData.data}
                                options={tempChartData.options}
                                plugins={tempChartData.plugins}
                                style={{ height: "clamp(220px, 42vh, 300px)" }}
                            />
                        ) : (
                            <span className="text-500 text-sm">Sin registros de temperatura para este período</span>
                        )}

                        {/* Tabla de correlación temperatura ambiente ↔ resistencias prendidas */}
                        {correlacion && correlacion.buckets && correlacion.buckets.length > 0 && (
                            <div className="panel-correlacion" style={{ marginTop: '0.7rem' }}>
                                <div className="panel-card__title" style={{ fontSize: '0.85rem' }}>
                                    <i className="fa-solid fa-link" />
                                    ¿La sala de curado afecta el encendido de resistencias?
                                </div>
                                <p style={{ fontSize: '0.78rem', color: 'var(--text-color-secondary)', margin: '0.2rem 0 0.5rem' }}>
                                    Para cada rango de temperatura de la sala medida en el período, qué porcentaje del tiempo estuvieron prendidas las resistencias.
                                </p>
                                <div className="panel-correlacion__grid" style={{ display: 'grid', gap: '0.4rem', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                                    {correlacion.buckets.map(b => {
                                        const pct = b.porcentajeOn ?? 0;
                                        // Un bucket con pocas muestras es ruido estadístico, no señal.
                                        const muestraBaja = (b.muestras ?? 0) < MIN_MUESTRAS_CORRELACION;
                                        // Color del badge según porcentaje
                                        const tone = pct >= 60 ? '#dc2626' : pct >= 30 ? '#d97706' : '#16a34a';
                                        return (
                                            <div key={`${b.desde}-${b.hasta}`}
                                                style={{
                                                    background: 'var(--chart-background)',
                                                    border: '1px solid var(--surface-border)',
                                                    borderRadius: '0.5rem',
                                                    padding: '0.5rem 0.65rem',
                                                    opacity: muestraBaja ? 0.5 : 1,
                                                }}>
                                                <div style={{ fontSize: '0.78rem', color: 'var(--text-color-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.3rem' }}>
                                                    <span>Sala {b.desde}–{b.hasta}°C</span>
                                                    {muestraBaja && (
                                                        <span title="Pocos tramos medidos en este rango — no es confiable todavía"
                                                            style={{ fontSize: '0.6rem', fontWeight: 600, color: '#d97706', background: 'rgba(217,119,6,0.12)', padding: '0.05rem 0.3rem', borderRadius: '0.3rem', whiteSpace: 'nowrap' }}>
                                                            muestra baja
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.2rem' }}>
                                                    <strong style={{ fontSize: '1.25rem', color: muestraBaja ? 'var(--text-color-secondary)' : tone }}>{pct.toFixed(1)}%</strong>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-color-secondary)' }}>
                                                        del tiempo
                                                    </span>
                                                </div>
                                                <div style={{
                                                    height: '4px',
                                                    background: 'var(--surface-border)',
                                                    borderRadius: '2px',
                                                    overflow: 'hidden',
                                                    marginTop: '0.3rem',
                                                }}>
                                                    <div style={{
                                                        width: `${Math.min(100, pct)}%`,
                                                        height: '100%',
                                                        background: muestraBaja ? 'var(--text-color-secondary)' : tone,
                                                    }} />
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-color-secondary)', marginTop: '0.25rem' }}>
                                                    {b.minutosOn}/{b.minutosTotal} min ON · {b.muestras} tramo{b.muestras === 1 ? '' : 's'} medido{b.muestras === 1 ? '' : 's'}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {(() => {
                                    // Lectura cualitativa: SOLO usar buckets con muestra suficiente.
                                    // Comparar buckets con 1-2 lecturas produce conclusiones engañosas.
                                    const confiables = (correlacion.buckets || []).filter(b => (b.muestras ?? 0) >= MIN_MUESTRAS_CORRELACION);
                                    let mensaje;
                                    let borde = 'var(--primary-color, #6366f1)';
                                    if (confiables.length < 2) {
                                        mensaje = `Todavía no hay suficiente data para sacar una conclusión confiable. Hacen falta al menos 2 rangos de temperatura de sala con ${MIN_MUESTRAS_CORRELACION}+ tramos medidos cada uno. A medida que se acumule histórico (y con los sensores estables) esto se va a ir poblando.`;
                                        borde = '#94a3b8';
                                    } else {
                                        const frio = confiables[0];
                                        const caliente = confiables[confiables.length - 1];
                                        const pctFrio = frio.porcentajeOn;
                                        const pctCaliente = caliente.porcentajeOn;
                                        const diff = pctFrio - pctCaliente;
                                        if (Math.abs(diff) < 10) {
                                            mensaje = `Entre ${frio.desde}–${frio.hasta}°C y ${caliente.desde}–${caliente.hasta}°C de sala las resistencias se prenden a un ritmo parecido (${pctFrio.toFixed(0)}% vs ${pctCaliente.toFixed(0)}%). La temperatura de la sala no parece estar afectando mucho el encendido en el período cargado.`;
                                        } else if (diff > 0) {
                                            mensaje = `Con la sala fría (${frio.desde}–${frio.hasta}°C) las resistencias están prendidas ${pctFrio.toFixed(0)}% del tiempo; con la sala más caliente (${caliente.desde}–${caliente.hasta}°C), ${pctCaliente.toFixed(0)}%. La temperatura de la sala SÍ está afectando — cuanto más fría la sala, más trabajan las resistencias.`;
                                            borde = '#d97706';
                                        } else {
                                            mensaje = `En el período cargado, las resistencias se prenden algo más con la sala más caliente (${pctCaliente.toFixed(0)}% en ${caliente.desde}–${caliente.hasta}°C vs ${pctFrio.toFixed(0)}% en ${frio.desde}–${frio.hasta}°C). Es contraintuitivo — probablemente la curación arrancó (probetas nuevas, objetivo más alto) en días templados. Mirá con más histórico.`;
                                        }
                                    }
                                    return (
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-color)', marginTop: '0.5rem', padding: '0.5rem 0.7rem', background: 'var(--cover-input-bg)', borderRadius: '0.4rem', borderLeft: `3px solid ${borde}` }}>
                                            <i className="fa-solid fa-lightbulb" style={{ marginRight: '0.4rem', color: '#f59e0b' }} />
                                            {mensaje}
                                        </p>
                                    );
                                })()}
                            </div>
                        )}
                    </div>

                    {/* ── Eventos del laboratorio ── */}
                    <div className="panel-card">
                        <div className="panel-card__title">
                            <i className="fa-solid fa-list-check" />
                            Eventos recientes (lab)
                        </div>
                        {labEventos.length > 0 ? (
                            <div className="panel-eventos__lista">
                                {labEventos.map((ev, i) => (
                                    <div key={i} className="panel-evento">
                                        <span className="panel-evento__hora">{formatHora(ev.timestamp)}</span>
                                        <span className="panel-evento__msg">{ev.mensaje}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <span className="text-500 text-sm">Sin eventos recientes</span>
                        )}
                    </div>

                    {/* ── Comandos enviados ── */}
                    <div className="panel-card">
                        <div className="panel-card__title">
                            <i className="fa-solid fa-paper-plane" />
                            Comandos enviados
                        </div>
                        {comandos.length > 0 ? (
                            <div className="panel-comandos__lista">
                                {comandos.map(c => (
                                    <div key={c.idComando} className="panel-comando">
                                        <div className="panel-comando__tipo">
                                            {LABELS_COMANDO[c.tipo] || c.tipo}
                                        </div>
                                        <Tag
                                            value={c.estado === "entregado" ? "Entregado" : "Pendiente"}
                                            severity={c.estado === "entregado" ? "success" : "warning"}
                                            style={{ fontSize: '0.7rem' }}
                                        />
                                        <span className="panel-comando__hora">{formatFechaCorta(c.createdAt)}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <span className="text-500 text-sm">Sin comandos enviados aún</span>
                        )}
                    </div>

                </div>
            </div>
        </Fade>
    );
};

export default PiletaPanel;
