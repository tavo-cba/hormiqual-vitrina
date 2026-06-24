import React, { useReducer, useState, useEffect, useMemo } from "react";
import axios from "axios";
import dayjs from "dayjs";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import jsPDF from "jspdf";
import "jspdf-autotable";

import "./reports-shared.css";
import FreshFilter from "./fresh-filter";
import { config } from "../../../config/config";
import { useConfig } from "../../../context/ConfigContext";
import { useToast } from "../../../context/ToastContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import { Tag } from "primereact/tag";
import { evaluarConsistencia, evaluarAire } from "../../../lib/normativa/consistenciaCirsoc";

const filtersReducer = (state, action) => {
    switch (action.type) {
        case "SET_FILTER":
            return { ...state, [action.payload.field]: action.payload.value };
        case "RESET_FILTERS":
            return {
                idCliente: null,
                tipoHormigon: null,
                idDosificacion: null,
                idObra: null,
                idPlanta: null,
                fechaDesde: null,
                fechaHasta: null,
            };
        default:
            return state;
    }
};

const ReportFresh = () => {
    const [filterVisible, setFilterVisible] = useState(false);
    const cfg = useConfig();
    const showToast = useToast();
    // PR9 NO aplica acá: el reporte trabaja sobre ensayos de hormigón
    // fresco ya colocado o producido. Asentamiento, aire, temperatura
    // se evalúan contra Tabla 4.1/4.2/4.3 CIRSOC — la norma es
    // soberana siempre. Ver CLAUDE.md frontend §"Modelo dual de
    // evaluación → IMPORTANTE - DÓNDE APLICA LA DUALIDAD".

    const [tempFilters, dispatch] = useReducer(filtersReducer, {
        idCliente: null,
        tipoHormigon: null,
        idDosificacion: null,
        idObra: null,
        idPlanta: null,
        fechaDesde: null,
        fechaHasta: null,
    });

    const [appliedFilters, setAppliedFilters] = useState({ ...tempFilters });
    const applyFilters = () => setAppliedFilters({ ...tempFilters });
    const clearAllFilters = () => {
        dispatch({ type: "RESET_FILTERS" });
        setAppliedFilters({
            idCliente: null,
            tipoHormigon: null,
            idDosificacion: null,
            idObra: null,
            idPlanta: null,
            fechaDesde: null,
            fechaHasta: null,
        });
    };

    const [showLote, setShowLote] = useState(true);
    const [showAire, setShowAire] = useState(true);
    const [showAsent, setShowAsent] = useState(true);
    const [showTempAmb, setShowTempAmb] = useState(true);
    const [showTempHorm, setShowTempHorm] = useState(true);

    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [tableFirst, setTableFirst] = useState(0);
    const [filterOpts, setFilterOpts] = useState({
        clienteOpts: [],
        obraOpts: [],
        plantaOpts: [],
        dosifOpts: [],
        hormigonOpts: [],
    });

    // Resetea paginación de la tabla al cambiar filtros aplicados
    // (regla CLAUDE.md: setFirst(0) al filtrar).
    useEffect(() => { setTableFirst(0); }, [appliedFilters]);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const params = {
                    idCliente: appliedFilters.idCliente || undefined,
                    idTipoHormigon: appliedFilters.tipoHormigon || undefined,
                    idDosificacion: appliedFilters.idDosificacion || undefined,
                    idObra: appliedFilters.idObra || undefined,
                    idPlanta: appliedFilters.idPlanta || undefined,
                    desde: appliedFilters.fechaDesde
                        ? dayjs(appliedFilters.fechaDesde).format("YYYY-MM-DD")
                        : undefined,
                    hasta: appliedFilters.fechaHasta
                        ? dayjs(appliedFilters.fechaHasta).format("YYYY-MM-DD")
                        : undefined,
                };
                const res = await axios.get(`${config.backendUrl}/api/muestras`, {
                    params,
                    headers: config.headers,
                });
                setData(res.data || []);
            } catch (err) {
                console.error('[ReportFresh] fetch:', err);
                showToast('error', 'No se pudieron cargar las muestras frescas.');
                setData([]);
            } finally {
                setLoading(false);
            }
        })();
    }, [appliedFilters, showToast]);

    const exportToPDF = async (empleadoFirma) => {
        const doc = new jsPDF('l');

        let logoData = null;
        if (cfg?.thumbnail) {
            try {
                const res = await fetch(cfg.thumbnail);
                const blob = await res.blob();
                logoData = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } catch (err) {
                console.error('No se pudo cargar el logo para el PDF', err);
            }
        }

        let firmaData = null;
        if (empleadoFirma?.firmaElectronicaBase64) {
            try {
                const res = await fetch(empleadoFirma.firmaElectronicaBase64);
                const blob = await res.blob();
                firmaData = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } catch (err) {
                console.error('No se pudo cargar la firma para el PDF', err);
            }
        }

        doc.setFontSize(16);
        doc.setFont('Helvetica', 'bold');
        doc.text('Reporte de Muestras Frescas', 14, 15);

        let yPos = 30;

        doc.setFontSize(13);
        doc.text('Filtros aplicados', 14, yPos);
        yPos += 4;
        // FRE-04: resolver labels desde las opciones del filtro (cargadas vía
        // onOptionsLoaded), no desde el primer registro de data — si data
        // viene vacío con filtro aplicado, antes mostraba "—" engañando al
        // usuario sobre qué se filtró.
        const labelOf = (opts, value) => {
            if (value == null) return null;
            const opt = opts.find(o => String(o.value) === String(value));
            return opt?.label ?? null;
        };
        const filtrosLabels = ['Cliente', 'Obra', 'Planta', 'Dosificación', 'Tipo Hormigón', 'Fecha desde', 'Fecha hasta'];
        const filtrosValues = [
            appliedFilters.idCliente ? (labelOf(filterOpts.clienteOpts, appliedFilters.idCliente) ?? `#${appliedFilters.idCliente}`) : 'Todos',
            appliedFilters.idObra ? (labelOf(filterOpts.obraOpts, appliedFilters.idObra) ?? `#${appliedFilters.idObra}`) : 'Todas',
            appliedFilters.idPlanta ? (labelOf(filterOpts.plantaOpts, appliedFilters.idPlanta) ?? `#${appliedFilters.idPlanta}`) : 'Todas',
            appliedFilters.idDosificacion ? (labelOf(filterOpts.dosifOpts, appliedFilters.idDosificacion) ?? `#${appliedFilters.idDosificacion}`) : 'Todas',
            appliedFilters.tipoHormigon ? (labelOf(filterOpts.hormigonOpts, appliedFilters.tipoHormigon) ?? `#${appliedFilters.tipoHormigon}`) : 'Todos',
            appliedFilters.fechaDesde ? dayjs(appliedFilters.fechaDesde).format('DD/MM/YYYY') : '—',
            appliedFilters.fechaHasta ? dayjs(appliedFilters.fechaHasta).format('DD/MM/YYYY') : '—',
        ];
        doc.autoTable({
            startY: yPos,
            head: [filtrosLabels],
            body: [filtrosValues],
            styles: { fontSize: 9 },
            headStyles: { fillColor: [52, 152, 219] },
        });
        yPos = doc.autoTable.previous.finalY + 10;

        const headers = ['ID Muestra'];
        if (showLote) headers.push('Tam. lote');
        if (showAire) {
            headers.push('Aire inc.');
            // S6 conexión Tabla 4.3 (sesión 2026-05-10): columna verifica
            // contra Tabla 4.3 CIRSOC 200-2024 §4.1.2 ± 1,5 %.
            headers.push('Cumple aire');
        }
        if (showAsent) {
            headers.push('Asentamiento');
            // S6 (FRE-02): columna nueva "Cumple consigna" verifica
            // contra Tabla 4.2 CIRSOC 200-2024 §4.1.1.
            headers.push('Cumple consigna');
        }
        if (showTempAmb) headers.push('Temp. exterior');
        if (showTempHorm) headers.push('Temp. hormigón');

        const rows = data.map(m => {
            const arr = [m.idMuestra];
            if (showLote) arr.push(m.probetas?.length ?? m.cantidadProbetas ?? '—');
            if (showAire) {
                arr.push(m.aireincorporado ?? '—');
                const tmnMm = m.dosificacion?.tamanioMaximoNominal?.tamanio;
                const claseExp = m.dosificacion?.durabilidadExposicion?.codigo;
                const aireR = evaluarAire(m.aireincorporado, tmnMm, claseExp);
                arr.push(aireR.evaluable ? (aireR.cumple ? 'Cumple' : 'Fuera') : '—');
            }
            if (showAsent) {
                // FRE-01: prioriza asentamientoMm (canónico IRAM 1536), muestra en cm.
                const medidoMm = m.asentamientoMm != null
                    ? Number(m.asentamientoMm)
                    : (m.asentamiento != null ? Number(m.asentamiento) * 10 : null);
                const cm = medidoMm != null
                    ? (medidoMm / 10).toString().replace('.', ',')
                    : '—';
                arr.push(cm);
                // S6: cumple consigna.
                const consignaCm = m.dosificacion?.asentamientoDisenio?.asentamiento;
                const consignaMm = consignaCm != null ? Number(consignaCm) * 10 : null;
                const r = evaluarConsistencia(medidoMm, consignaMm);
                arr.push(r.evaluable ? (r.cumple ? 'Cumple' : 'Fuera') : '—');
            }
            if (showTempAmb) arr.push(m.temperaturaAmbiente ?? '—');
            if (showTempHorm) arr.push(m.temperaturaHormigon ?? '—');
            return arr;
        });

        doc.autoTable({ startY: yPos, head: [headers], body: rows, styles: { fontSize: 9 }, headStyles: { fillColor: [52, 152, 219] } });
        yPos = doc.autoTable.previous.finalY + 6;

        // S6 (FRE-02): footer con ratios de cumplimiento + citas normativas
        // explícitas. Se muestran solo los ratios que tienen al menos una
        // muestra evaluable (no inflar el reporte con 0/0).
        doc.setFontSize(9);
        if (showAsent && stats?.consigna?.evaluables > 0) {
            doc.text(
                `Cumplimiento de asentamiento (CIRSOC 200-2024 §4.1.1 Tabla 4.2): ` +
                `${stats.consigna.cumplen} de ${stats.consigna.evaluables} muestras dentro de tolerancia ` +
                `(${stats.consigna.pct} %).`,
                14,
                yPos
            );
            yPos += 6;
        }
        if (showAire && stats?.aire?.evaluables > 0) {
            doc.text(
                `Cumplimiento de aire incorporado (CIRSOC 200-2024 §4.1.2 Tabla 4.3 ± 1,5 %): ` +
                `${stats.aire.cumplen} de ${stats.aire.evaluables} muestras dentro de tolerancia ` +
                `(${stats.aire.pct} %).`,
                14,
                yPos
            );
            yPos += 6;
        }

        const totalPages = doc.internal.getNumberOfPages();
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const bottomMargin = 23;

        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            if (i === 1 && logoData) {
                doc.addImage(logoData, 'PNG', pageW - 25, 10, 10, 10);
            }
            const footer = `Pagina ${i}/${totalPages}`;
            doc.setFontSize(9);
            const txtW = doc.getTextWidth(footer);
            doc.text(footer, pageW - txtW - 10, pageH - 7);

            if (i === totalPages && empleadoFirma && firmaData) {
                const yFirma = pageH - bottomMargin + 2;
                const imgW = 30;
                const imgH = 8;
                doc.addImage(firmaData, 'PNG', (pageW - imgW) / 2, yFirma, imgW, imgH);
                const yNombre = yFirma + imgH + 5;
                const nombre = `${empleadoFirma.apellido}, ${empleadoFirma.nombre}`;
                doc.text(nombre, pageW / 2, yNombre, { align: 'center' });
                const yEmpresa = yNombre + 2;
                if (cfg?.nombreEmpresa) {
                    doc.setFontSize(8);
                    const disclaimer = `${cfg.nombreEmpresa} no se responsabiliza por el mal uso o interpretación del presente informe.`;
                    const lines = doc.splitTextToSize(disclaimer, pageW - 40);
                    doc.text(lines, pageW / 2, yEmpresa + 3, { align: 'center' });
                    doc.setFontSize(9);
                }
            }
        }

        doc.save('Reporte_Muestras.pdf');
    };

    const sortedData = useMemo(() => data, [data]);

    // Cálculos para stats. Fix FRE-01: prioriza `asentamientoMm` (canónico
    // IRAM 1536) sobre `asentamiento` (DECIMAL deprecado en cm). Promedio
    // expresado en cm (con coma decimal es-AR) para consistencia con la
    // columna y la práctica de planta.
    //
    // S6 (FRE-02): agregamos % de cumplimiento de asentamiento contra
    // Tabla 4.2 CIRSOC 200-2024 §4.1.1. Solo se cuentan las muestras
    // que tienen consigna+medido (las indeterminadas no entran al ratio).
    const stats = useMemo(() => {
        if (!data.length) return null;
        const asentCm = data
            .map(d => d.asentamientoMm != null
                ? Number(d.asentamientoMm) / 10
                : (d.asentamiento != null ? Number(d.asentamiento) : null))
            .filter(v => v != null && Number.isFinite(v));
        const tempHorm = data.map(d => d.temperaturaHormigon).filter(v => v != null);
        const tempAmb = data.map(d => d.temperaturaAmbiente).filter(v => v != null);

        // Conformidad asentamiento (FRE-02 — S6).
        let evaluables = 0;
        let cumplen = 0;
        // Conformidad aire incorporado (FRE-02 — S6 conexión).
        let aireEvaluables = 0;
        let aireCumplen = 0;
        for (const m of data) {
            const medidoMm = m.asentamientoMm != null
                ? Number(m.asentamientoMm)
                : (m.asentamiento != null ? Number(m.asentamiento) * 10 : null);
            const consignaCm = m.dosificacion?.asentamientoDisenio?.asentamiento;
            const consignaMm = consignaCm != null ? Number(consignaCm) * 10 : null;
            const r = evaluarConsistencia(medidoMm, consignaMm);
            if (r.evaluable) {
                evaluables += 1;
                if (r.cumple) cumplen += 1;
            }

            // Aire: requiere TMN + clase de exposición + medición. Mientras
            // las dosificaciones legacy no tengan `idDurabilidadExposicion`
            // poblada, esto va a quedar siempre `evaluable: false` y la
            // UI lo expone como '—' en lugar de mentir con un veredicto.
            const tmnMm = m.dosificacion?.tamanioMaximoNominal?.tamanio;
            const claseExp = m.dosificacion?.durabilidadExposicion?.codigo;
            const aireR = evaluarAire(m.aireincorporado, tmnMm, claseExp);
            if (aireR.evaluable) {
                aireEvaluables += 1;
                if (aireR.cumple) aireCumplen += 1;
            }
        }
        const cumplePct = evaluables > 0 ? Math.round((cumplen / evaluables) * 100) : null;
        const airePct = aireEvaluables > 0 ? Math.round((aireCumplen / aireEvaluables) * 100) : null;

        const fmt1 = (v) => v.toFixed(1).replace('.', ',');
        return {
            total: data.length,
            asentProm: asentCm.length ? fmt1(asentCm.reduce((a, b) => a + b, 0) / asentCm.length) : '—',
            tempHormProm: tempHorm.length ? fmt1(tempHorm.reduce((a, b) => Number(a) + Number(b), 0) / tempHorm.length) : '—',
            tempAmbProm: tempAmb.length ? fmt1(tempAmb.reduce((a, b) => Number(a) + Number(b), 0) / tempAmb.length) : '—',
            consigna: { evaluables, cumplen, pct: cumplePct },
            aire: { evaluables: aireEvaluables, cumplen: aireCumplen, pct: airePct },
        };
    }, [data]);

    return (
        <div className="reports-module">
            {/* Overlay móvil */}
            <div
                className={`rpt-mobile-overlay ${filterVisible ? 'visible' : ''}`}
                onClick={() => setFilterVisible(false)}
            />

            {/* Botón flotante móvil */}
            <button
                className="rpt-mobile-filter-btn"
                onClick={() => setFilterVisible(true)}
            >
                <i className="fa-solid fa-sliders" />
            </button>

            {/* Panel de Filtros */}
            <FreshFilter
                visible={filterVisible}
                setVisible={setFilterVisible}
                tempFilters={tempFilters}
                dispatch={dispatch}
                handleApplyFilters={applyFilters}
                handleClearAllFilters={clearAllFilters}
                exportToPDF={exportToPDF}
                showLote={showLote}
                setShowLote={setShowLote}
                showAire={showAire}
                setShowAire={setShowAire}
                showAsent={showAsent}
                setShowAsent={setShowAsent}
                showTempAmb={showTempAmb}
                setShowTempAmb={setShowTempAmb}
                showTempHorm={showTempHorm}
                setShowTempHorm={setShowTempHorm}
                onOptionsLoaded={setFilterOpts}
            />

            {/* Panel Principal */}
            <div className="rpt-main-panel">
                {/* Header */}
                <div className="rpt-report-header">
                    <h1 className="rpt-report-title">
                        <span className="rpt-report-title-icon rpt-report-title-icon--fresh">
                            <i className="fa-solid fa-droplet" />
                        </span>
                        Muestras Frescas
                    </h1>
                    {data.length > 0 && (
                        <span className="rpt-report-badge rpt-report-badge--fresh">
                            <i className="fa-solid fa-vial" />
                            {data.length} muestra{data.length !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>



                {/* Stats cards */}
                {stats && !loading && (
                    <div className="rpt-stats-row">
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Total muestras</p>
                            <p className="rpt-stat-value">{stats.total}</p>
                        </div>
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Asentamiento prom.</p>
                            <p className="rpt-stat-value rpt-stat-value--small">{stats.asentProm} cm</p>
                        </div>
                        {/* S6 (FRE-02): card de conformidad CIRSOC §4.1.1 Tabla 4.2.
                            Solo muestra ratio si al menos una muestra tiene
                            consigna+medido. */}
                        {stats.consigna.evaluables > 0 && (
                            <div
                                className="rpt-stat-card"
                                title={`${stats.consigna.cumplen} de ${stats.consigna.evaluables} muestras dentro de tolerancia (CIRSOC 200-2024 §4.1.1 Tabla 4.2). Las muestras sin consigna o sin medición no entran al ratio.`}
                            >
                                <p className="rpt-stat-label">Cumple consigna</p>
                                <p
                                    className="rpt-stat-value rpt-stat-value--small"
                                    style={{
                                        color:
                                            stats.consigna.pct >= 95 ? 'var(--green-500)' :
                                                stats.consigna.pct >= 80 ? 'var(--orange-500)' :
                                                    'var(--red-500)',
                                    }}
                                >
                                    {stats.consigna.pct}% <small style={{ fontSize: '0.7em', color: 'var(--text-color-secondary)' }}>({stats.consigna.cumplen}/{stats.consigna.evaluables})</small>
                                </p>
                            </div>
                        )}
                        {stats.aire.evaluables > 0 && (
                            <div
                                className="rpt-stat-card"
                                title={`${stats.aire.cumplen} de ${stats.aire.evaluables} muestras con aire dentro de tolerancia (CIRSOC 200-2024 §4.1.2 Tabla 4.3 ± 1,5 %). Las muestras sin TMN o sin clase de exposición declarada en la dosificación no entran al ratio.`}
                            >
                                <p className="rpt-stat-label">Cumple aire</p>
                                <p
                                    className="rpt-stat-value rpt-stat-value--small"
                                    style={{
                                        color:
                                            stats.aire.pct >= 95 ? 'var(--green-500)' :
                                                stats.aire.pct >= 80 ? 'var(--orange-500)' :
                                                    'var(--red-500)',
                                    }}
                                >
                                    {stats.aire.pct}% <small style={{ fontSize: '0.7em', color: 'var(--text-color-secondary)' }}>({stats.aire.cumplen}/{stats.aire.evaluables})</small>
                                </p>
                            </div>
                        )}
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Temp. H° prom.</p>
                            <p className="rpt-stat-value rpt-stat-value--small">{stats.tempHormProm}°C</p>
                        </div>
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Temp. Amb. prom.</p>
                            <p className="rpt-stat-value rpt-stat-value--small">{stats.tempAmbProm}°C</p>
                        </div>
                    </div>
                )}

                {/* Contenido principal */}
                {loading ? (
                    <div className="rpt-loading">
                        <LoadSpinner />
                    </div>
                ) : sortedData.length > 0 ? (
                    <div className="rpt-table-card">
                        <div className="rpt-table-header">
                            <h3 className="rpt-table-title">
                                <i className="fa-solid fa-list rpt-table-title-icon rpt-table-title-icon--fresh" />
                                Listado de muestras
                            </h3>
                            <span className="rpt-table-count">
                                {sortedData.length} registro{sortedData.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="rpt-datatable">
                            <DataTable
                                value={sortedData}
                                paginator
                                rows={25}
                                rowsPerPageOptions={[25, 50, 100]}
                                first={tableFirst}
                                onPage={(e) => setTableFirst(e.first)}
                                scrollable
                                emptyMessage={
                                    <div className="rpt-empty-state" style={{ padding: '2rem' }}>
                                        <p>No hay registros</p>
                                    </div>
                                }
                            >
                                <Column field="idMuestra" header="ID Muestra" sortable />
                                <Column
                                    header="Tam. lote"
                                    body={r => r.probetas?.length ?? r.cantidadProbetas ?? '—'}
                                    sortable
                                />
                                <Column
                                    field="aireIncorporado"
                                    header="Aire inc."
                                    body={(m) => m.aireincorporado ?? '—'}
                                    sortable
                                />
                                <Column
                                    header="Cumple aire"
                                    body={(m) => {
                                        // Verificación CIRSOC 200-2024 §4.1.2 Tabla 4.3 ± 1,5 %.
                                        // Requiere TMN del agregado grueso + clase de exposición
                                        // de durabilidad declarados en la dosificación. Si faltan,
                                        // muestra '—' (no inventa veredicto).
                                        const tmnMm = m.dosificacion?.tamanioMaximoNominal?.tamanio;
                                        const claseExp = m.dosificacion?.durabilidadExposicion?.codigo;
                                        const r = evaluarAire(m.aireincorporado, tmnMm, claseExp);
                                        if (!r.evaluable) {
                                            const motivoTxt = {
                                                DATOS_INCOMPLETOS: 'Falta aire medido, TMN o clase de exposición.',
                                                CLASE_EXPOSICION_INVALIDA: 'Clase de exposición no es C1/C2.',
                                                TMN_NO_TABULADO: 'TMN del agregado fuera de Tabla 4.3 (13,2 / 19 / 26,5 / 37,5 mm).',
                                                REQUIERE_TAMIZADO_37_5_PREVIO: 'TMN ≥ 53 mm: la medición debe hacerse sobre fracción tamizada por 37,5 mm.',
                                            }[r.motivo] || 'No evaluable.';
                                            return <span className="text-500" title={motivoTxt}>—</span>;
                                        }
                                        const tip = `Centro ${r.centro} % ± ${r.tolerancia} % (TMN ${r.tmnTabla} mm × ${r.claseExposicion}). Rango ${r.minPct}–${r.maxPct} %. ${r.cita}`;
                                        return (
                                            <Tag
                                                value={r.cumple ? 'Cumple' : 'Fuera'}
                                                severity={r.cumple ? 'success' : 'danger'}
                                                title={tip}
                                            />
                                        );
                                    }}
                                />
                                <Column
                                    field="asentamientoMm"
                                    header="Asentamiento"
                                    body={(m) => {
                                        // Prioriza asentamientoMm (canónico IRAM 1536) sobre `asentamiento`
                                        // (DECIMAL deprecado en cm). Fix FRE-01 auditoría 2026-05-09.
                                        const mm = m.asentamientoMm != null
                                            ? Number(m.asentamientoMm)
                                            : (m.asentamiento != null ? Number(m.asentamiento) * 10 : null);
                                        if (mm == null) return '—';
                                        const cm = (mm / 10).toString().replace('.', ',');
                                        return `${cm} cm`;
                                    }}
                                    sortable
                                />
                                <Column
                                    header="Cumple consigna"
                                    body={(m) => {
                                        // Verificación CIRSOC 200-2024 §4.1.1 Tabla 4.2 (FIX-4 auditoría
                                        // 2026-05-09, validado por revisor-civil). La tolerancia depende de
                                        // la clase de consistencia derivada de la consigna.
                                        const medidoMm = m.asentamientoMm != null
                                            ? Number(m.asentamientoMm)
                                            : (m.asentamiento != null ? Number(m.asentamiento) * 10 : null);
                                        const consignaCm = m.dosificacion?.asentamientoDisenio?.asentamiento;
                                        const consignaMm = consignaCm != null ? Number(consignaCm) * 10 : null;
                                        const r = evaluarConsistencia(medidoMm, consignaMm);
                                        if (!r.evaluable) {
                                            return <span className="text-500" title="Falta consigna o medición">—</span>;
                                        }
                                        const tip = `Consigna ${(r.consignaMm / 10).toString().replace('.', ',')} cm ± ${r.toleranciaMm} mm (${r.consistencia.label}). Rango ${(r.minMm / 10).toString().replace('.', ',')}–${(r.maxMm / 10).toString().replace('.', ',')} cm. ${r.cita}`;
                                        return (
                                            <Tag
                                                value={r.cumple ? 'Cumple' : 'Fuera'}
                                                severity={r.cumple ? 'success' : 'danger'}
                                                title={tip}
                                            />
                                        );
                                    }}
                                />
                                <Column
                                    field="temperaturaAmbiente"
                                    header="Temp. ambiente"
                                    body={(m) => m.temperaturaAmbiente != null ? `${m.temperaturaAmbiente}°C` : '—'}
                                    sortable
                                />
                                <Column
                                    field="temperaturaHormigon"
                                    header="Temp. hormigón"
                                    body={(m) => m.temperaturaHormigon != null ? `${m.temperaturaHormigon}°C` : '—'}
                                    sortable
                                />
                            </DataTable>
                        </div>
                    </div>
                ) : (
                    <div className="rpt-empty-state">
                        <div className="rpt-empty-state-icon">
                            <i className="fa-solid fa-droplet-slash" />
                        </div>
                        <h2 className="rpt-empty-state-title">Sin muestras frescas</h2>
                        <p className="rpt-empty-state-text">
                            No se encontraron registros con los filtros seleccionados. Probá ajustando los criterios de búsqueda.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReportFresh;