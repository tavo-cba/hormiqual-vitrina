// src/components/admin/probeta/uikit/ProbetaForm.jsx
import React, { useState, useEffect, useMemo, useContext, useRef } from "react";
import {
    InputText,
    InputNumber,
    Calendar,
    Dropdown,
    Button,
    Divider,
} from "primereact";
import { Fade } from "react-awesome-reveal";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useToast } from "../../../../context/ToastContext";
import { ThemeContext } from "../../../../context/ThemeContext";
import axios from "axios";
import { config } from "../../../../config/config";
import { formatDate, parseLocalDate } from "../../../../common/functions";
import LoadSpinner from "../../../../common/components/loadspinner/LoadSpinner";
import EnsayoForm from "./ensayoForm";
import { Chart as PrimeChart } from "primereact/chart";
import "chart.js/auto";
import "./PiletaTemperaturaDialog.css";
import { ESTADOS_NO_ENSAYABLES } from "../../../../lib/constants/estadoProbeta";

/* helper */
const mapOpt = (arr, l, v) => arr.map(o => ({ label: o[l], value: o[v] }));

const ProbetaForm = () => {
    const { modo, id } = useParams();
    const editing = modo === "editar";
    const navigate = useNavigate();
    const location = useLocation();
    const toast = useToast();
    const { isDark } = useContext(ThemeContext);

    /* ---------- catálogos ---------- */
    const [estados, setEstados] = useState([]);

    /* ---------- state ---------- */
    const [nombre, setNombre] = useState("");
    const [fecha, setFecha] = useState(null);
    const [idEstadoProbeta, setIdEstadoProbeta] = useState(1);
    const [observaciones, setObservaciones] = useState("");
    const [codigo, setCodigo] = useState("");
    const [diasRotura, setDiasRotura] = useState(28);
    const [fechaRotura, setFechaRotura] = useState(null);
    const [planta, setPlanta] = useState(null);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [loading, setLoading] = useState(false);
    const [idTipoProbeta, setIdTipoProbeta] = useState(null);
    const [idPlantaDespacho, setIdPlantaDespacho] = useState(null);

    /* ---------- estado ensayo (via hijo) ---------- */
    const [ensayoPayload, setEnsayoPayload] = useState(null);
    const [bloqueoPlaca, setBloqueoPlaca] = useState({ bloqueado: false, estado: null });

    /* ---------- temperatura pileta ---------- */
    const [tempData, setTempData] = useState(null);

    /* ---------- catálogos ---------- */
    useEffect(() => {
        (async () => {
            try {
                // [VITRINA] El módulo Despachos está recortado; los estados de
                // probeta se sirven desde el router de probetas (montado).
                const { data } = await axios.get(`${config.backendUrl}/api/probetas/estados`, { headers: config.headers });
                setEstados(Array.isArray(data) ? data : []);
            } catch (err) {
                console.error("No se pudieron cargar los estados de probeta:", err);
                setEstados([]);
            }
        })();
    }, []);

    /* ---------- cargar probeta + ensayo ---------- */
    useEffect(() => {
        if (!editing) return;
        (async () => {
            setLoading(true);
            try {
                const { data } = await axios.get(`${config.backendUrl}/api/probetas/${id}`, { headers: config.headers });
                setNombre(data.nombre);
                // Fix 2026-05-20: las probetas de pastón también traen
                // Fecha + Planta — vienen via `muestraPaston` (no `muestra`
                // ni `muestraTerceros`). Sin este fallback los campos quedaban
                // vacíos en el form y al guardar el ensayo el backend tiraba
                // "edadEnsayo cannot be null".
                setFecha(
                    data.muestra?.despacho?.fecha
                    ?? data.muestra?.fecha            // [VITRINA] muestra standalone (sin despacho)
                    ?? data.muestraTerceros?.fecha
                    ?? data.muestraPaston?.fecha
                );
                setPlanta(
                    data.muestra?.despacho?.planta?.nombre
                    ?? data.muestra?.planta?.nombre   // [VITRINA] planta propia de la muestra standalone
                    ?? data.muestraTerceros?.planta?.nombre
                    ?? data.muestraPaston?.planta?.nombre
                );
                setIdPlantaDespacho(
                    data.muestra?.despacho?.planta?.idPlanta
                    ?? data.muestra?.planta?.idPlanta // [VITRINA] muestra standalone
                    ?? data.muestraTerceros?.planta?.idPlanta
                    ?? data.muestraPaston?.planta?.idPlanta
                    ?? null
                );
                setIdEstadoProbeta(data.idEstadoProbeta);
                setObservaciones(data.observaciones || "");
                setCodigo(data.codigo || "");
                setDiasRotura(data.diasRotura || 28);
                setFechaRotura(data.fechaRotura ? new Date(data.fechaRotura) : null);
                // Probeta de pastón: el tipo de probeta vive directo en Probeta.tipoProbeta
                // (no en muestra.tipoprobeta). Fallback explícito.
                setIdTipoProbeta(
                    data.muestra?.tipoprobeta?.idTipoProbeta
                    ?? data.muestraTerceros?.tipoProbeta?.idTipoProbeta
                    ?? data.tipoProbeta?.idTipoProbeta
                    ?? data.idTipoProbeta
                    ?? null
                );
                // si viene ensayo relacionado lo seteamos
                if (data.ensayo) {
                    setEnsayoPayload({ ...data.ensayo });
                }
                // cargar temperatura si tiene pileta
                if (data.idPileta) {
                    try {
                        const tempRes = await axios.get(`${config.backendUrl}/api/probetas/${id}/temperatura`, { headers: config.headers });
                        setTempData(tempRes.data);
                    } catch (_) {
                        // temperatura no crítica, ignorar error
                    }
                }
            } catch (e) {
                toast("error", "No se pudo cargar la probeta");
                window.history.back();
            } finally {
                setLoading(false);
            }
        })();
    }, [editing, id]);

    /* ---------- chart temperatura ---------- */
    const tempChart = useMemo(() => {
        if (!tempData?.dailyData?.length) return null;
        const textColor = isDark ? "#e2e8f0" : "#374151";
        const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
        const objetivo = tempData.stats?.objetivo;
        const umbral = tempData.stats?.umbral ?? 3;
        const labels = tempData.dailyData.map((d) => {
            const [, m, day] = d.fecha.split("-");
            return `${day}/${m}`;
        });
        const datasets = [
            {
                label: "Promedio",
                data: tempData.dailyData.map((d) => d.avg),
                borderColor: "#3b82f6",
                backgroundColor: "rgba(59,130,246,0.1)",
                fill: true,
                tension: 0.35,
                pointRadius: tempData.dailyData.length > 20 ? 2 : 4,
                pointBackgroundColor: tempData.dailyData.map((d) => d.fueraRango ? "#ef4444" : "#3b82f6"),
                pointBorderColor: tempData.dailyData.map((d) => d.fueraRango ? "#ef4444" : "#3b82f6"),
                borderWidth: 2,
            },
            {
                label: "Mín/Máx",
                data: tempData.dailyData.map((d) => d.min),
                borderColor: isDark ? "#64748b" : "#9ca3af",
                borderDash: [4, 4],
                pointRadius: 0,
                fill: false,
                borderWidth: 1,
            },
            {
                label: " ",
                data: tempData.dailyData.map((d) => d.max),
                borderColor: isDark ? "#64748b" : "#9ca3af",
                borderDash: [4, 4],
                pointRadius: 0,
                fill: false,
                borderWidth: 1,
            },
        ];
        if (objetivo) {
            datasets.push({ label: "Objetivo", data: tempData.dailyData.map(() => objetivo), borderColor: "#10b981", borderDash: [6, 3], pointRadius: 0, fill: false, borderWidth: 1.5 });
            datasets.push({ label: `±${umbral}°C`, data: tempData.dailyData.map(() => objetivo + umbral), borderColor: "rgba(239,68,68,0.35)", borderDash: [3, 3], pointRadius: 0, fill: false, borderWidth: 1 });
            datasets.push({ label: " ", data: tempData.dailyData.map(() => objetivo - umbral), borderColor: "rgba(239,68,68,0.35)", borderDash: [3, 3], pointRadius: 0, fill: false, borderWidth: 1 });
        }
        return {
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { labels: { color: textColor, boxWidth: 10, font: { size: 10 } } },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}°C` } },
                },
                scales: {
                    x: { ticks: { color: textColor, maxRotation: 45, font: { size: 10 } }, grid: { color: gridColor } },
                    y: { ticks: { color: textColor, callback: (v) => `${v}°C`, font: { size: 10 } }, grid: { color: gridColor } },
                },
            },
        };
    }, [tempData, isDark]);

    /* ---------- guardar ---------- */
    const handleSave = async (e) => {
        e.preventDefault();
        if (savingRef.current) return;
        if (!nombre) return toast("warn", "Nombre requerido");
        if (!ensayoPayload && (idEstadoProbeta == 2 || idEstadoProbeta == 3)) return toast("warn", "Guarda el ensayo de resistencia primero");
        const probetaPayload = {
            nombre,
            idEstadoProbeta,
            observaciones,
            codigo,
            diasRotura,
            fechaRotura,
        };

        try {
            savingRef.current = true;
            setSaving(true);
            let probetaId = id;

            if (editing) {
                await axios.put(`${config.backendUrl}/api/probetas/${id}`, probetaPayload, { headers: config.headers });
            } else {
                const { data } = await axios.post(`${config.backendUrl}/api/probetas`, probetaPayload, { headers: config.headers });
                probetaId = data.idProbeta;
            }

            /* ---- guardamos / actualizamos ensayo ---- */
            if (ensayoPayload) {
                const endpoint = ensayoPayload.idEnsayoResistencia
                    ? `${config.backendUrl}/api/probetas/ensayo/${ensayoPayload.idEnsayoResistencia}`
                    : `${config.backendUrl}/api/probetas/ensayo`;
                const method = ensayoPayload.idEnsayoResistencia ? "put" : "post";
                await axios[method](endpoint, { ...ensayoPayload, idProbeta: probetaId }, { headers: config.headers });
            }

            toast("success", editing ? "Probeta actualizada" : "Probeta creada");
            const listadoPath = location.pathname.includes('probetas-terceros')
                ? '/calidad/ensayos/probetas-terceros'
                : '/calidad/ensayos/probetas';
            navigate(listadoPath);
        } catch (err) {
            const msg = err.response?.data?.error || "Error al guardar";
            toast("error", msg);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="cover-container w-full h-full flex align-self-center justify-content-center">
                <LoadSpinner />
            </div>
        );
    }

    /* ---------- render ---------- */
    // El formulario de ensayo se habilita para cualquier probeta existente que
    // NO esté en estado terminal (Descartada/Perdida) — espejo de
    // `ESTADOS_NO_ENSAYABLES` del backend. Incluye explícitamente "Curando":
    // como nada flipea Curando→Pendiente al vencer la fecha de rotura, una
    // probeta lista para romper suele seguir figurando "Curando" y antes
    // quedaba sin formulario de carga. Se exige `editing` para no mostrar el
    // formulario al crear una probeta nueva (flujo sin ensayo).
    const puedeCargarEnsayo = editing && !ESTADOS_NO_ENSAYABLES.includes(idEstadoProbeta);
    return (
        <Fade direction="up" duration={500} triggerOnce>
            <div className="w-full flex-column flex justify-content-center align-items-center py-5">
                <div className="form-card-header flex align-items-center justify-content-between w-full xl:w-6">
                    <h3 className="m-0">
                        <i className="fa-solid fa-flask mr-2" />
                        {editing ? "Editar probeta" : "Nueva probeta"}
                    </h3>
                    <i
                        className="fa-solid fa-circle-arrow-left cursor-pointer hover-red"
                        style={{ fontSize: "1.2rem" }}
                        onClick={() => window.history.back()}
                    ></i>
                </div>

                <form className="form-card p-4 w-full xl:w-6" onSubmit={(e) => e.preventDefault()}>
                    {/* -------- datos probeta -------- */}
                    <div className="flex w-full flex-wrap">
                        <div className="flex flex-column col-6 md:col-4">
                            <label>Nombre</label>
                            <InputText value={nombre} disabled />
                        </div>
                        <div className="flex flex-column col-6 md:col-4">
                            <label>Fecha</label>
                            <InputText value={formatDate(fecha)} disabled />
                        </div>
                        <div className="flex flex-column col-6 md:col-4">
                            <label>Planta</label>
                            <InputText value={planta} disabled />
                        </div>
                        <div className="flex flex-column col-6 md:col-4">
                            <label>Estado</label>
                            <Dropdown
                                value={idEstadoProbeta}
                                onChange={e => setIdEstadoProbeta(e.value)}
                                options={estados}
                                optionLabel="estado"
                                optionValue="idEstadoProbeta"
                                
                                className="w-full"
                                disabled
                            />
                        </div>

                        <div className="col-6 md:col-4">
                            <label>Días de rotura</label>
                            <InputNumber value={diasRotura} onChange={e => setDiasRotura(e.value)} min={1} disabled className="w-full" inputClassName="w-full" />
                        </div>
                        <div className="col-6 md:col-4">
                            <label>Rotura prevista</label>
                            <Calendar value={fechaRotura} onChange={e => setFechaRotura(e.value)} disabled showOnFocus={false} dateFormat="dd/mm/yy" className="w-full" />
                        </div>
                        <div className="flex flex-column col-12 sm:col-6 lg:col-4">
                            <label>Código</label>
                            <InputText value={codigo} onChange={e => setCodigo(e.target.value)} className="w-full" />
                        </div>
                        <div className="flex flex-column col-12 md:col-8">
                            <label>Observaciones</label>
                            <InputText value={observaciones} onChange={e => setObservaciones(e.target.value)} className="w-full" />
                        </div>
                    </div>
                    {/* -------- temperatura de curado ---------- */}
                    {tempData && (
                        <div className="mt-3">
                            <Divider />
                            <div className="flex align-items-center gap-2 mb-2">
                                <i className="fa-solid fa-temperature-half" style={{ color: "#3b82f6" }} />
                                <span className="font-bold" style={{ color: "var(--text-color)" }}>
                                    Temperatura de curado — {tempData.pileta?.nombre}
                                    {tempData.pileta?.planta && (
                                        <span style={{ color: "var(--text-color-secondary)", fontWeight: 400 }}>
                                            {" "}— {tempData.pileta.planta.nombre}
                                        </span>
                                    )}
                                </span>
                            </div>

                            {!tempData.dailyData?.length ? (
                                <p style={{ color: "var(--text-color-secondary)", fontSize: "0.87rem" }}>
                                    Sin registros de temperatura para este período de curado.
                                </p>
                            ) : (
                                <>
                                    {/* Stats compactos */}
                                    <div className="pileta-temp-stats mb-3">
                                        {[
                                            { label: "Promedio", value: `${tempData.stats?.avg}°C`, color: "#3b82f6" },
                                            { label: "Mínima", value: `${tempData.stats?.min}°C`, color: isDark ? "#94a3b8" : "#6b7280" },
                                            { label: "Máxima", value: `${tempData.stats?.max}°C`, color: isDark ? "#f97316" : "#f59e0b" },
                                            { label: "Días monit.", value: `${tempData.stats?.totalDias}`, color: "var(--text-color)" },
                                            ...(tempData.stats?.objetivo ? [{ label: "Objetivo", value: `${tempData.stats.objetivo}°C`, color: "#10b981" }] : []),
                                        ].map((s) => (
                                            <div key={s.label} className="pileta-temp-stat">
                                                <span className="pileta-temp-stat__label">{s.label}</span>
                                                <span className="pileta-temp-stat__value" style={{ color: s.color }}>{s.value}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {tempData.stats?.diasFueraRango > 0 && (
                                        <div className="pileta-temp-alert mb-3">
                                            <i className="fa-solid fa-triangle-exclamation mr-2" />
                                            <span>
                                                <strong>{tempData.stats.diasFueraRango} día{tempData.stats.diasFueraRango !== 1 ? "s" : ""}</strong> con temperatura fuera del rango permitido
                                                {tempData.stats.objetivo ? ` (objetivo ${tempData.stats.objetivo}°C ± ${tempData.stats.umbral}°C)` : ""}.
                                            </span>
                                        </div>
                                    )}

                                    {tempChart && (
                                        <div className="pileta-temp-chart">
                                            <PrimeChart
                                                type="line"
                                                data={tempChart.data}
                                                options={tempChart.options}
                                                style={{ height: "240px" }}
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* -------- formulario ENSAYO ---------- */}
                    {
                        puedeCargarEnsayo ?
                            <EnsayoForm
                                key={ensayoPayload?.idEnsayoResistencia || "nuevo"}
                                initialData={{ ...ensayoPayload, idProbeta: id }}
                                idTipoProbeta={idTipoProbeta}
                                idPlantaDespacho={idPlantaDespacho}
                                saving={saving}
                                onSave={setEnsayoPayload}
                                onPlacaBloqueoChange={(bloqueado, estado) => setBloqueoPlaca({ bloqueado, estado })}
                            />
                            :
                            null
                    }

                    <div className="flex flex-column align-items-center mt-4 gap-2">
                        {bloqueoPlaca.bloqueado && (
                            <small className="text-color-secondary text-center" style={{ maxWidth: 480 }}>
                                <i className="fa-solid fa-lock mr-1" />
                                {bloqueoPlaca.estado === 'bloqueado'
                                    ? 'No se puede guardar: las placas de elastómero están agotadas. Reemplace el juego.'
                                    : 'No se puede guardar: las placas alcanzaron el límite normativo. Extienda el uso o reemplace el juego.'}
                            </small>
                        )}
                        <Button
                            label="Guardar"
                            icon="fa-solid fa-check"
                            size="small"
                            rounded
                            loading={saving}
                            disabled={bloqueoPlaca.bloqueado || saving}
                            tooltip={bloqueoPlaca.bloqueado ? 'Resuelva el estado de las placas de elastómero antes de guardar' : null}
                            onClick={(e) => handleSave(e)}
                        />
                    </div>
                </form>
            </div>
        </Fade>
    );
};

export default ProbetaForm;
