import React, { useState, useEffect, useCallback, useRef } from "react";
import { ProgressSpinner } from "primereact/progressspinner";
import axios from "axios";
import { config } from "../../../config/config";
import "./BcraInfo.css";

/* ── Constantes ── */

const SITUACIONES = {
    1: { label: "Normal",                      color: "bcra-sit-1" },
    2: { label: "Con seguimiento especial",    color: "bcra-sit-2" },
    3: { label: "Con problemas",               color: "bcra-sit-3" },
    4: { label: "Alto riesgo de insolvencia",  color: "bcra-sit-4" },
    5: { label: "Irrecuperable",               color: "bcra-sit-5" },
    6: { label: "Irrecuperable (disp. técn.)", color: "bcra-sit-6" },
};

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
                    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/* ── Formatters ── */

// Montos en miles de pesos (API BCRA lo informa así)
const fmtMiles = (v) =>
    v == null ? "-" :
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })
        .format(v * 1000);

// Montos en pesos reales (cheques)
const fmtPesos = (v) =>
    v == null ? "-" :
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })
        .format(v);

// Período "MM/YY" → "Ene 2026"
const fmtMMYY = (p) => {
    const [m, y] = String(p || "").split("/");
    const mes = parseInt(m, 10);
    if (!isNaN(mes) && y) return `${MESES[mes] || m} 20${y}`;
    return p;
};

// { mes, anio } → "Ene 2026"
const fmtMesAnio = (mes, anio) => `${MESES[mes] || mes} ${anio}`;

// Fecha ISO → "03/12/2024"
const fmtFecha = (f) =>
    f ? new Date(f).toLocaleDateString("es-AR") : "-";

/* ── Procesadores de datos ── */

// Normaliza la respuesta al formato de la API web, independientemente de la fuente
const normalizar = (data) => {
    if (data?.source === 'web') return data; // ya tiene el formato correcto

    // Convertir formato api.bcra.gob.ar → formato compatible
    const periodos = data?.deudas?.results?.periodos || [];
    const registros = [];
    for (const p of periodos) {
        for (const ent of p.entidades || []) {
            const [y, m] = String(p.periodo).match(/^(\d{4})(\d{2})$/)?.slice(1) || [null, null];
            registros.push({
                entidad: ent.denominacion || `Entidad ${ent.entidad}`,
                periodo: y && m ? `${m}/${String(y).slice(2)}` : String(p.periodo),
                situacion: ent.situacion,
                monto: ent.monto,
                dias_atraso: ent.diasAtrasoPago,
            });
        }
    }

    // Historia24 desde DeudaHistorica
    let historia24 = { tiene_datos: false, entidades: [] };
    if (data?.historico?.results?.entidades?.length) {
        historia24 = {
            tiene_datos: true,
            entidades: (data.historico.results.entidades || []).map(ent => ({
                nombre: ent.denominacion || `Entidad ${ent.entidad}`,
                periodos: (ent.periodos || [])
                    .filter(p => p.situacion != null && p.situacion !== "-")
                    .map(p => {
                        const s = String(p.periodo);
                        return {
                            mes: parseInt(s.slice(4, 6), 10),
                            anio: parseInt(s.slice(0, 4), 10),
                            situacion: parseInt(p.situacion, 10) || null,
                            monto: typeof p.monto === 'number' ? p.monto : parseFloat(p.monto) || null,
                            proceso_judicial: p.procesoJudicial || null,
                        };
                    }),
            })),
        };
    }

    return {
        source: 'api',
        titular: data?.deudas?.results?.denominacion || null,
        deudas: {
            tiene_datos: registros.length > 0,
            registros,
            referencias: { proceso_judicial: false },
        },
        cheques: null, // No disponible en api.bcra.gob.ar
        historia24,
        morosos: { tiene_datos: false, registros: [] },
        enlaces_externos: null,
    };
};

const procesarDeudas = (rawData) => {
    const data = normalizar(rawData);
    const registros = data?.deudas?.registros;
    if (!registros?.length) return null;

    // Agrupar por período
    const periodoMap = {};
    for (const r of registros) {
        if (!periodoMap[r.periodo]) periodoMap[r.periodo] = { entidades: [], totalMonto: 0, peorSit: 1 };
        periodoMap[r.periodo].entidades.push(r);
        periodoMap[r.periodo].totalMonto += r.monto || 0;
        if ((r.situacion || 1) > periodoMap[r.periodo].peorSit)
            periodoMap[r.periodo].peorSit = r.situacion;
    }

    // Ordenar períodos descendente (por año luego por mes)
    const sortedKeys = Object.keys(periodoMap).sort((a, b) => {
        const [am, ay] = a.split("/").map(Number);
        const [bm, by] = b.split("/").map(Number);
        return by !== ay ? by - ay : bm - am;
    });

    const ultimoKey = sortedKeys[0];
    const sitActual = periodoMap[ultimoKey].peorSit;

    // Peor situación en todos los períodos disponibles
    let peorSituacion = sitActual;
    let peorPeriodo = ultimoKey;
    for (const k of sortedKeys) {
        if (periodoMap[k].peorSit > peorSituacion) {
            peorSituacion = periodoMap[k].peorSit;
            peorPeriodo = k;
        }
    }

    return {
        periodo: ultimoKey,
        sitActual,
        peorSituacion,
        peorPeriodo,
        totalMonto: periodoMap[ultimoKey].totalMonto,
        entidades: periodoMap[ultimoKey].entidades,
        todosLosPeriodos: sortedKeys.map(k => ({ periodo: k, ...periodoMap[k] })),
        procesoJudicial: data.deudas.referencias?.proceso_judicial,
        titular: data.titular,
    };
};

const procesarCheques = (rawData) => {
    const data = normalizar(rawData);
    const ch = data?.cheques;
    if (!ch?.tiene_datos_personales && !ch?.tiene_datos_juridicos) return null;

    const registros = [
        ...(ch.personales?.registros || []),
        ...(ch.juridicos?.registros || []),
    ];
    if (!registros.length) return null;

    const impagos = registros.filter(r => !r.fecha_pago).length;
    const totalMonto = registros.reduce((s, r) => s + (r.monto || 0), 0);
    const resumen = ch.personales?.resumen || ch.juridicos?.resumen;

    return {
        totalCheques: registros.length,
        totalMonto,
        impagos,
        porcentajeAbonados: resumen?.porcentaje_abonados ?? null,
        detalle: registros,
        bancos: ch.resumen_por_banco?.personales?.bancos || ch.resumen_por_banco?.general?.bancos || [],
    };
};

/* ── Análisis de riesgo ── */

const analizarRiesgo = (deudasInfo, chequesInfo, data) => {
    let puntuacion = 0;
    const alertas = [];
    const factores = [];

    if (deudasInfo) {
        const sit = deudasInfo.peorSituacion;
        const esPasado = sit > deudasInfo.sitActual;
        const sfx = esPasado ? ` (${fmtMMYY(deudasInfo.peorPeriodo)})` : "";

        if (sit >= 5)       { puntuacion += 50; alertas.push(`Deuda irrecuperable en el sistema financiero${sfx}`); }
        else if (sit === 4) { puntuacion += 35; alertas.push(`Alto riesgo de insolvencia financiera${sfx}`); }
        else if (sit === 3) { puntuacion += 20; alertas.push(`Problemas en el sistema financiero${sfx}`); }
        else if (sit === 2) { puntuacion += 10; factores.push("Bajo seguimiento especial"); }
        else                {                   factores.push("Situación financiera normal"); }

        if (deudasInfo.procesoJudicial || data?.morosos?.tiene_proceso_judicial) {
            puntuacion += 25;
            alertas.push("Proceso judicial activo");
        }
    }

    // Tendencia de los últimos meses (historia24)
    if (data?.historia24?.tiene_datos) {
        const sitsPorPeriodo = {};
        for (const ent of data?.historia24?.entidades || []) {
            for (const p of ent.periodos || []) {
                if (p.situacion != null) {
                    const key = `${p.anio}-${String(p.mes).padStart(2, "0")}`;
                    if (!sitsPorPeriodo[key] || p.situacion > sitsPorPeriodo[key])
                        sitsPorPeriodo[key] = p.situacion;
                }
            }
        }
        const keys = Object.keys(sitsPorPeriodo).sort((a, b) => b.localeCompare(a));
        if (keys.length >= 2) {
            const actual = sitsPorPeriodo[keys[0]];
            const anterior = sitsPorPeriodo[keys[1]];
            if (actual > anterior) { puntuacion += 10; alertas.push("Tendencia de deterioro crediticio"); }
            else if (actual < anterior) { factores.push("Tendencia de mejora crediticia"); }
        }
    }

    if (chequesInfo) {
        if (chequesInfo.impagos > 0) {
            puntuacion += 20 + chequesInfo.impagos * 3;
            alertas.push(`${chequesInfo.impagos} cheque${chequesInfo.impagos > 1 ? "s" : ""} rechazado${chequesInfo.impagos > 1 ? "s" : ""} sin regularizar`);
        } else {
            factores.push(`${chequesInfo.totalCheques} cheque${chequesInfo.totalCheques > 1 ? "s" : ""} rechazado${chequesInfo.totalCheques > 1 ? "s" : ""} (todos regularizados)`);
        }
    }

    let nivel, color, icono;
    if (!deudasInfo && !chequesInfo) {
        nivel = "Sin antecedentes"; color = "riesgo-ninguno"; icono = "fa-circle-check";
    } else if (puntuacion === 0) {
        nivel = "Bajo";      color = "riesgo-bajo";     icono = "fa-circle-check";
    } else if (puntuacion <= 15) {
        nivel = "Moderado";  color = "riesgo-moderado"; icono = "fa-circle-exclamation";
    } else if (puntuacion <= 35) {
        nivel = "Alto";      color = "riesgo-alto";     icono = "fa-triangle-exclamation";
    } else {
        nivel = "Muy alto";  color = "riesgo-muy-alto"; icono = "fa-skull-crossbones";
    }

    return { nivel, color, icono, alertas, factores, puntuacion };
};

/* ── Componente principal ── */

const BcraInfo = ({ cuit }) => {
    const [loading, setLoading] = useState(false);
    const [data, setData]       = useState(null);
    const [fetchError, setFetchError] = useState(null);
    const [expanded, setExpanded]     = useState(false);
    const lastFetchedCuit = useRef(null);

    const fetchBcra = useCallback(async (cuitValue) => {
        lastFetchedCuit.current = cuitValue;
        setLoading(true);
        setFetchError(null);
        setData(null);
        setExpanded(false);
        try {
            const res = await axios.get(
                `${config.backendUrl}/api/bcra/${cuitValue}`,
                { headers: config.headers }
            );
            if (lastFetchedCuit.current === cuitValue) setData(res.data);
        } catch (err) {
            console.error("Error consultando BCRA:", err);
            if (lastFetchedCuit.current === cuitValue)
                setFetchError("No se pudo conectar con el BCRA. Verificá la conexión o intentá más tarde.");
        } finally {
            if (lastFetchedCuit.current === cuitValue) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const s = (cuit || "").replace(/\D/g, "");
        if (s.length === 11) fetchBcra(s);
        else { setData(null); setFetchError(null); lastFetchedCuit.current = null; }
    }, [cuit, fetchBcra]);

    const sanitized = (cuit || "").replace(/\D/g, "");
    if (sanitized.length !== 11) return null;

    const apiError = data?.error === true;
    const normalData = data && !apiError ? normalizar(data) : null;
    const deudasInfo  = normalData ? procesarDeudas(data)  : null;
    const chequesInfo = normalData ? procesarCheques(data) : null;
    const riesgo = normalData ? analizarRiesgo(deudasInfo, chequesInfo, normalData) : null;
    const hayProblemas = riesgo && riesgo.puntuacion > 15;

    return (
        <div className={`bcra-info-panel ${hayProblemas ? "bcra-info-panel--alerta" : ""}`}>

            {/* Header */}
            <div className="bcra-info-header">
                <i className="fa-solid fa-landmark mr-2"></i>
                <span className="bcra-info-title">BCRA — Central de Deudores del Sistema Financiero</span>
                {loading && <ProgressSpinner style={{ width: "18px", height: "18px" }} strokeWidth="5" className="ml-2" />}
                {data && !apiError && !loading && (
                    <button type="button" className="bcra-toggle-btn ml-auto"
                        onClick={() => setExpanded(v => !v)}>
                        <i className={`fa-solid fa-chevron-${expanded ? "up" : "down"}`}></i>
                        <span className="ml-1">{expanded ? "Ocultar" : "Ver detalle"}</span>
                    </button>
                )}
            </div>

            {/* Errores */}
            {fetchError && (
                <div className="bcra-error">
                    <i className="fa-solid fa-triangle-exclamation mr-2"></i>{fetchError}
                </div>
            )}
            {apiError && (
                <div className="bcra-error">
                    <i className="fa-solid fa-triangle-exclamation mr-2"></i>
                    No se pudo obtener información del BCRA.
                </div>
            )}

            {/* Análisis de riesgo */}
            {!fetchError && !loading && riesgo && (
                <div className="bcra-riesgo-container">
                    <div className={`bcra-riesgo-badge ${riesgo.color}`}>
                        <i className={`fa-solid ${riesgo.icono} mr-2`}></i>
                        Riesgo crediticio:&nbsp;<strong>{riesgo.nivel}</strong>
                    </div>
                    {riesgo.alertas.length > 0 && (
                        <ul className="bcra-alertas">
                            {riesgo.alertas.map((a, i) => (
                                <li key={i}><i className="fa-solid fa-circle-dot mr-1"></i>{a}</li>
                            ))}
                        </ul>
                    )}
                    {riesgo.alertas.length === 0 && riesgo.factores.length > 0 && (
                        <ul className="bcra-factores">
                            {riesgo.factores.map((f, i) => (
                                <li key={i}><i className="fa-solid fa-circle-dot mr-1"></i>{f}</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* Resumen compacto */}
            {!fetchError && !loading && normalData && !apiError && (
                <div className="bcra-resumen">
                    {deudasInfo ? (
                        <div className="bcra-bloque">
                            <div className="bcra-bloque-label">Situación crediticia</div>
                            <div className="bcra-sit-row">
                                <span className={`bcra-badge ${(SITUACIONES[deudasInfo.sitActual] || SITUACIONES[1]).color}`}>
                                    {deudasInfo.sitActual} — {(SITUACIONES[deudasInfo.sitActual] || SITUACIONES[1]).label}
                                </span>
                                {deudasInfo.peorSituacion > deudasInfo.sitActual && (
                                    <span className={`bcra-badge ${(SITUACIONES[deudasInfo.peorSituacion] || SITUACIONES[1]).color}`}
                                        title={`Peor situación en ${fmtMMYY(deudasInfo.peorPeriodo)}`}>
                                        <i className="fa-solid fa-clock-rotate-left mr-1" style={{fontSize:"0.7rem"}}></i>
                                        {deudasInfo.peorSituacion} — {(SITUACIONES[deudasInfo.peorSituacion] || SITUACIONES[1]).label}
                                    </span>
                                )}
                            </div>
                            <div className="bcra-sub mt-1">
                                Actual: {fmtMMYY(deudasInfo.periodo)} — Deuda: <strong>{fmtMiles(deudasInfo.totalMonto)}</strong>
                                {deudasInfo.peorSituacion > deudasInfo.sitActual && (
                                    <span className="ml-2 bcra-nota">peor: {fmtMMYY(deudasInfo.peorPeriodo)}</span>
                                )}
                            </div>
                        </div>
                    ) : !apiError && normalData.deudas?.tiene_datos === false && (
                        <div className="bcra-bloque">
                            <div className="bcra-bloque-label">Deudas financieras</div>
                            <span className="bcra-badge bcra-sit-1">Sin deudas registradas</span>
                        </div>
                    )}

                    {chequesInfo ? (
                        <div className="bcra-bloque">
                            <div className="bcra-bloque-label">Cheques rechazados</div>
                            <span className={`bcra-badge ${chequesInfo.impagos > 0 ? "bcra-sit-4" : "bcra-sit-2"}`}>
                                <i className="fa-solid fa-ban mr-1"></i>
                                {chequesInfo.totalCheques} cheque{chequesInfo.totalCheques !== 1 ? "s" : ""}
                                {chequesInfo.impagos > 0
                                    ? ` (${chequesInfo.impagos} sin regularizar)`
                                    : " (todos regularizados)"}
                            </span>
                            <div className="bcra-sub mt-1">
                                Total: <strong>{fmtPesos(chequesInfo.totalMonto)}</strong>
                                {chequesInfo.porcentajeAbonados != null && (
                                    <span className="ml-2 bcra-nota">{chequesInfo.porcentajeAbonados.toFixed(0)}% regularizado</span>
                                )}
                            </div>
                        </div>
                    ) : !chequesInfo && !apiError && (
                        <div className="bcra-bloque">
                            <div className="bcra-bloque-label">Cheques rechazados</div>
                            <a
                                href={`https://www.bcra.gob.ar/situacion-crediticia/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bcra-enlace bcra-enlace-cheques"
                                title="Los cheques rechazados requieren verificación con CAPTCHA en el sitio oficial del BCRA"
                            >
                                <i className="fa-solid fa-arrow-up-right-from-square mr-1"></i>
                                Consultar en BCRA
                            </a>
                            <div className="bcra-nota mt-1">Requiere verificación manual</div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Detalle expandible ── */}
            {expanded && normalData && !apiError && (
                <div className="bcra-detail">

                    {/* Deudas por período */}
                    {deudasInfo ? (
                        <div className="bcra-detail-section">
                            <div className="bcra-detail-subtitle">
                                <i className="fa-solid fa-building-columns mr-2"></i>
                                Deudas en el sistema financiero
                                {deudasInfo.titular && <span className="bcra-titular ml-2">— {deudasInfo.titular.trim()}</span>}
                            </div>
                            {deudasInfo.todosLosPeriodos.map((p) => {
                                const sitP = SITUACIONES[p.peorSit] || SITUACIONES[1];
                                return (
                                    <div key={p.periodo} className="bcra-periodo">
                                        <div className="bcra-periodo-header">
                                            <strong>{fmtMMYY(p.periodo)}</strong>
                                            <span className={`bcra-badge ml-2 ${sitP.color}`}>{p.peorSit} — {sitP.label}</span>
                                            <span className="ml-auto bcra-sub">{fmtMiles(p.totalMonto)}</span>
                                        </div>
                                        <table className="bcra-table">
                                            <thead>
                                                <tr><th>Entidad</th><th>Sit.</th><th>Monto</th><th>Días atraso</th></tr>
                                            </thead>
                                            <tbody>
                                                {p.entidades.map((ent, i) => {
                                                    const s = SITUACIONES[ent.situacion] || SITUACIONES[1];
                                                    return (
                                                        <tr key={i}>
                                                            <td>{ent.entidad?.trim()}</td>
                                                            <td><span className={`bcra-badge-sm ${s.color}`}>{ent.situacion}</span></td>
                                                            <td>{fmtMiles(ent.monto)}</td>
                                                            <td>{ent.dias_atraso ?? "N/A"}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="bcra-sin-antecedentes mb-3">Sin deudas en el sistema financiero</div>
                    )}

                    {/* Historia 24 meses por entidad */}
                    {normalData.historia24?.tiene_datos && (
                        <div className="bcra-detail-section mt-3">
                            <div className="bcra-detail-subtitle">
                                <i className="fa-solid fa-clock-rotate-left mr-2"></i>
                                Historia por entidad (últimos 24 meses)
                            </div>
                            {(normalData.historia24.entidades || []).map((ent, ei) => {
                                const conDatos = (ent.periodos || []).filter(p => p.situacion != null);
                                if (!conDatos.length) return null;
                                return (
                                    <div key={ei} className="bcra-hist-entidad">
                                        <div className="bcra-hist-nombre">{ent.nombre?.trim()}</div>
                                        <table className="bcra-table">
                                            <thead>
                                                <tr><th>Período</th><th>Situación</th><th>Monto</th><th>Proc. Jud.</th></tr>
                                            </thead>
                                            <tbody>
                                                {conDatos.map((p, pi) => {
                                                    const s = SITUACIONES[p.situacion] || SITUACIONES[1];
                                                    return (
                                                        <tr key={pi}>
                                                            <td>{fmtMesAnio(p.mes, p.anio)}</td>
                                                            <td><span className={`bcra-badge-sm ${s.color}`}>{p.situacion} — {s.label}</span></td>
                                                            <td>{fmtMiles(p.monto)}</td>
                                                            <td>{p.proceso_judicial ? <span className="bcra-flag bcra-flag-danger">Sí</span> : "-"}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Cheques rechazados */}
                    {chequesInfo ? (
                        <div className="bcra-detail-section mt-3">
                            <div className="bcra-detail-subtitle">
                                <i className="fa-solid fa-ban mr-2"></i>
                                Cheques rechazados ({chequesInfo.totalCheques}
                                {chequesInfo.impagos > 0 ? `, ${chequesInfo.impagos} sin regularizar` : ", todos regularizados"}
                                {chequesInfo.porcentajeAbonados != null && ` — ${chequesInfo.porcentajeAbonados.toFixed(0)}% abonado`})
                            </div>
                            <table className="bcra-table">
                                <thead>
                                    <tr><th>N° Cheque</th><th>Fecha rechazo</th><th>Monto</th><th>Causal</th><th>Pago multa</th><th>Estado</th></tr>
                                </thead>
                                <tbody>
                                    {chequesInfo.detalle.map((ch, i) => (
                                        <tr key={i}>
                                            <td>{ch.cheque}</td>
                                            <td>{fmtFecha(ch.fecha_rechazo)}</td>
                                            <td>{fmtPesos(ch.monto)}</td>
                                            <td>{ch.causal?.trim()}</td>
                                            <td>{ch.multa?.trim() || "-"}</td>
                                            <td>
                                                {ch.fecha_pago
                                                    ? <span className="bcra-badge-sm bcra-sit-1">Regularizado {fmtFecha(ch.fecha_pago)}</span>
                                                    : <span className="bcra-badge-sm bcra-sit-4">Sin pagar</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Resumen por banco */}
                            {chequesInfo.bancos.length > 0 && (
                                <div className="bcra-bancos mt-2">
                                    <div className="bcra-bancos-titulo">Resumen por banco:</div>
                                    {chequesInfo.bancos.map((b, i) => (
                                        <div key={i} className="bcra-banco-row">
                                            <span className="bcra-banco-nombre">{b.entidad?.trim()}</span>
                                            <span className="bcra-sub ml-2">
                                                {b.sin_fondos.cantidad} cheque{b.sin_fondos.cantidad !== 1 ? "s" : ""}
                                                {" · "}{fmtPesos(b.sin_fondos.monto)}
                                                {b.abonados.cantidad > 0 && ` · ${b.abonados.cantidad} regularizados`}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bcra-detail-section mt-3">
                            <div className="bcra-detail-subtitle">
                                <i className="fa-solid fa-ban mr-2"></i>
                                Cheques rechazados
                            </div>
                            <div className="bcra-cheques-aviso">
                                <i className="fa-solid fa-lock mr-2"></i>
                                Los cheques rechazados requieren verificación con CAPTCHA en el sitio oficial del BCRA.
                                <a
                                    href="https://www.bcra.gob.ar/situacion-crediticia/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-2"
                                >
                                    Consultar manualmente <i className="fa-solid fa-arrow-up-right-from-square"></i>
                                </a>
                            </div>
                        </div>
                    )}

                    {/* Otros registros (morosos, rectificadas, liquidación) */}
                    {normalData.morosos?.tiene_datos && (
                        <div className="bcra-detail-section mt-3">
                            <div className="bcra-detail-subtitle">
                                <i className="fa-solid fa-circle-xmark mr-2"></i>
                                Deudas morosas en proceso de gestión
                            </div>
                            <table className="bcra-table">
                                <thead>
                                    <tr><th>Entidad</th><th>Período</th><th>Sit.</th><th>Monto</th></tr>
                                </thead>
                                <tbody>
                                    {normalData.morosos.registros.map((r, i) => {
                                        const s = SITUACIONES[r.situacion] || SITUACIONES[1];
                                        return (
                                            <tr key={i}>
                                                <td>{r.entidad?.trim()}</td>
                                                <td>{fmtMMYY(r.periodo)}</td>
                                                <td><span className={`bcra-badge-sm ${s.color}`}>{r.situacion}</span></td>
                                                <td>{fmtMiles(r.monto)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Links externos */}
                    {normalData.enlaces_externos && (
                        <div className="bcra-enlaces mt-3">
                            <div className="bcra-enlaces-titulo">
                                <i className="fa-solid fa-arrow-up-right-from-square mr-1"></i>
                                Consultar también en:
                            </div>
                            <div className="bcra-enlaces-lista">
                                {normalData.enlaces_externos.arba && (
                                    <a href={normalData.enlaces_externos.arba} target="_blank" rel="noopener noreferrer" className="bcra-enlace">ARBA</a>
                                )}
                                {normalData.enlaces_externos.anses && (
                                    <a href={normalData.enlaces_externos.anses} target="_blank" rel="noopener noreferrer" className="bcra-enlace">ANSES</a>
                                )}
                                {normalData.enlaces_externos.rentas_cordoba && (
                                    <a href={normalData.enlaces_externos.rentas_cordoba} target="_blank" rel="noopener noreferrer" className="bcra-enlace">Rentas Córdoba</a>
                                )}
                                {normalData.enlaces_externos.rentas_corrientes && (
                                    <a href={normalData.enlaces_externos.rentas_corrientes} target="_blank" rel="noopener noreferrer" className="bcra-enlace">Rentas Corrientes</a>
                                )}
                                {normalData.enlaces_externos.rentas_salta && (
                                    <a href={normalData.enlaces_externos.rentas_salta} target="_blank" rel="noopener noreferrer" className="bcra-enlace">Rentas Salta</a>
                                )}
                                {normalData.enlaces_externos.facturas_mipymes && (
                                    <a href={normalData.enlaces_externos.facturas_mipymes} target="_blank" rel="noopener noreferrer" className="bcra-enlace">Factura MiPyME</a>
                                )}
                                {normalData.enlaces_externos.procrear && (
                                    <a href={normalData.enlaces_externos.procrear} target="_blank" rel="noopener noreferrer" className="bcra-enlace">ProCreAr</a>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="bcra-detail-footer">
                        <i className="fa-solid fa-circle-info mr-1"></i>
                        Fuente: BCRA — Central de Deudores del Sistema Financiero. Solo refleja deudas con entidades
                        financieras (bancos, financieras). <strong>No incluye</strong> deudas con AFIP/ARCA, proveedores,
                        ni burós privados (Veraz, Nosis). Los montos de deuda están en miles de pesos.
                    </div>
                </div>
            )}
        </div>
    );
};

export default BcraInfo;
