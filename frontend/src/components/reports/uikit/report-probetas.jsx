import React, { useEffect, useReducer, useState, useMemo } from "react";
import axios from "axios";
import dayjs from "dayjs";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import jsPDF from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";

import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";

import "./reports-shared.css";
import ProbetasFilter from "./probetas-filter";
import { config } from "../../../config/config";
import { useConfig } from "../../../context/ConfigContext";
import { useToast } from "../../../context/ToastContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import { registerDejavuOnDoc, hasDejavuLoaded } from "../../../lib/format/dejavuFont";
import { formatNumber } from "../../../lib/format";

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
                idEstadoProbeta: null,
            };
        default:
            return state;
    }
};

const estadoLabels = {
    1: "Curando",
    2: "Pendiente",
    3: "Ensayada",
    4: "Descartada",
    5: "Perdida",
};

const estadoClassMap = {
    1: "rpt-status-badge--curando",
    2: "rpt-status-badge--pendiente",
    3: "rpt-status-badge--ensayada",
    4: "rpt-status-badge--descartada",
    5: "rpt-status-badge--perdida",
};

const ReportProbetas = () => {
    const [filterVisible, setFilterVisible] = useState(false);

    const [tempFilters, dispatch] = useReducer(filtersReducer, {
        idCliente: null,
        tipoHormigon: null,
        idDosificacion: null,
        idObra: null,
        idPlanta: null,
        fechaDesde: null,
        fechaHasta: null,
        idEstadoProbeta: null,
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
            idEstadoProbeta: null,
        });
    };

    const [showCliente, setShowCliente] = useState(true);
    const [showDosificacion, setShowDosificacion] = useState(true);
    const [showTipo, setShowTipo] = useState(true);
    const [showPlanta, setShowPlanta] = useState(true);
    const [showObra, setShowObra] = useState(true);
    const [showSabana, setShowSabana] = useState(true);
    const [showResistencia, setShowResistencia] = useState(false);
    const [muestrasTerceros, setMuestrasTerceros] = useState(false);
    const [tipoFecha, setTipoFecha] = useState('confeccion');

    const [probetas, setProbetas] = useState([]);
    const [loading, setLoading] = useState(false);

    const [previewVisible, setPreviewVisible] = useState(false);
    const [selectedProbetas, setSelectedProbetas] = useState([]);
    const [pdfConfig, setPdfConfig] = useState({ firmaEmpleado: null, productorHormigon: "" });
    const [tableFirst, setTableFirst] = useState(0);
    const [previewFirst, setPreviewFirst] = useState(0);

    // Resetea paginación al cambiar filtros aplicados (regla CLAUDE.md).
    useEffect(() => {
        setTableFirst(0);
        setPreviewFirst(0);
    }, [muestrasTerceros, tipoFecha, appliedFilters]);

    const cfg = useConfig();
    const showToast = useToast();
    // PR9 NO aplica acá: el listado opera sobre probetas ya
    // moldeadas/curadas/ensayadas. Lógica operativa (vencidas, badges
    // de estado), no veredicto de aptitud de catálogo. Ver CLAUDE.md
    // frontend §"Modelo dual de evaluación".

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const normalizeHastaDate = (date) =>
                    dayjs(date).add(1, "day").format("YYYY-MM-DD");
                const params = {
                    muestrasTerceros,
                    tipoFecha,
                    idCliente: appliedFilters.idCliente || undefined,
                    idTipoHormigon: appliedFilters.tipoHormigon || undefined,
                    idDosificacion: appliedFilters.idDosificacion || undefined,
                    idObra: appliedFilters.idObra || undefined,
                    idPlanta: appliedFilters.idPlanta || undefined,
                    idEstadoProbeta: appliedFilters.idEstadoProbeta || undefined,
                    desde: appliedFilters.fechaDesde
                        ? dayjs(appliedFilters.fechaDesde).format("YYYY-MM-DD")
                        : undefined,
                    hasta: appliedFilters.fechaHasta
                        ? normalizeHastaDate(appliedFilters.fechaHasta)
                        : undefined,
                };
                const res = await axios.get(
                    `${config.backendUrl}/api/probetas/filtradas`,
                    { params, headers: config.headers }
                );
                setProbetas(res.data ?? []);
            } catch (err) {
                console.error('[ReportProbetas] fetch:', err);
                showToast('error', 'No se pudieron cargar las probetas.');
                setProbetas([]);
            } finally {
                setLoading(false);
            }
        })();
    }, [muestrasTerceros, tipoFecha, appliedFilters, showToast]);

    // Helpers — preferir el snapshot directo de Muestra (cubre muestras sin
    // despacho); el despacho queda como fallback para registros legacy.
    const formatFecha = (iso) => (iso ? dayjs(iso).format("DD/MM/YYYY") : "—");
    /** Formatea un valor numérico (resistencia, peso, etc.) con coma decimal
     *  es-AR. Devuelve "—" para null/undefined. */
    const formatResistencia = (v) =>
        v == null ? "—" : formatNumber(v, { precision: 2, forceDecimals: true });
    const getCliente = (p) => {
        const c =
            p.muestra?.cliente ||
            p.muestra?.despacho?.cliente ||
            p.muestraTerceros?.cliente;
        if (!c) return "—";
        if (c.tipoPersona === "Jurídica") return c.razonSocial;
        return [c.apellido, c.nombre].filter(Boolean).join(', ') || c.nombre;
    };
    const getPlanta = (p) =>
        p.muestra?.planta?.nombre ||
        p.muestra?.despacho?.planta?.nombre ||
        p.muestraTerceros?.planta?.nombre ||
        "—";
    const getObra = (p) =>
        p.muestra?.obra?.nombre ||
        p.muestra?.despacho?.obra?.nombre ||
        p.muestraTerceros?.obra?.nombre ||
        "—";
    const getDosif = (p) =>
        p.muestra?.dosificacion?.nombre ||
        p.muestra?.despacho?.dosificacion?.nombre ||
        "—";
    const getTipo = (p) =>
        p.muestra?.tipoHormigon?.tipoHormigon ||
        p.muestra?.dosificacion?.tipoHormigon?.tipoHormigon ||
        p.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon ||
        p.muestraTerceros?.tipoHormigon?.tipoHormigon ||
        "—";
    const getFechaConf = (p) =>
        p.muestra?.fecha ||
        p.muestra?.despacho?.fecha ||
        p.muestraTerceros?.fecha ||
        null;

    // Overdue detection helper
    const isOverdue = (p) => {
        if (!p.fechaRotura) return false;
        // Only pending (2) or curando (1) can be overdue
        if (p.idEstadoProbeta !== 1 && p.idEstadoProbeta !== 2) return false;
        return dayjs(p.fechaRotura).isBefore(dayjs(), "day");
    };

    const diasAtraso = (p) => {
        if (!p.fechaRotura || !isOverdue(p)) return 0;
        return dayjs().diff(dayjs(p.fechaRotura), "day");
    };

    // Stats
    const stats = useMemo(() => {
        if (!probetas.length) return null;

        const byStatus = probetas.reduce((acc, p) => {
            const estado = p.idEstadoProbeta;
            acc[estado] = (acc[estado] || 0) + 1;
            return acc;
        }, {});

        const vencidas = probetas.filter(isOverdue).length;

        return {
            total: probetas.length,
            curando: byStatus[1] || 0,
            pendiente: byStatus[2] || 0,
            ensayada: byStatus[3] || 0,
            descartada: (byStatus[4] || 0) + (byStatus[5] || 0),
            vencidas,
        };
    }, [probetas]); // eslint-disable-line react-hooks/exhaustive-deps

    // Exportar Excel
    const exportToExcel = () => {
        const rows = probetas.map((p) => ({
            Nombre: p.nombre,
            Cliente: getCliente(p),
            Obra: getObra(p),
            Planta: getPlanta(p),
            "Tipo H°": getTipo(p),
            "Rotura prevista": formatFecha(p.fechaRotura),
            "Rotura real": formatFecha(p.ensayo?.fechaEnsayo),
            ...(showResistencia ? { "Resistencia (MPa)": formatResistencia(p.ensayo?.resistencia) } : {}),
            Estado: estadoLabels[p.idEstadoProbeta] || "—",
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Probetas");
        XLSX.writeFile(wb, "Listado_Probetas.xlsx");
    };

    // Abrir preview de selección antes de exportar PDF
    const handlePreviewPDF = (firmaEmpleado, productorHormigon) => {
        setPdfConfig({ firmaEmpleado, productorHormigon });
        setSelectedProbetas([...probetas]);
        setPreviewVisible(true);
    };

    const handleGeneratePDF = () => {
        exportToPDF(pdfConfig.firmaEmpleado, pdfConfig.productorHormigon, selectedProbetas);
        setPreviewVisible(false);
    };

    // Exportar PDF
    const exportToPDF = async (firmaEmpleado, productorHormigon, probeList) => {
        // Compute stats from the selected list
        const pdfStats = (() => {
            if (!probeList.length) return null;
            const byStatus = probeList.reduce((acc, p) => {
                acc[p.idEstadoProbeta] = (acc[p.idEstadoProbeta] || 0) + 1;
                return acc;
            }, {});
            const vencidas = probeList.filter(isOverdue).length;
            return {
                total: probeList.length,
                curando: byStatus[1] || 0,
                pendiente: byStatus[2] || 0,
                ensayada: byStatus[3] || 0,
                descartada: (byStatus[4] || 0) + (byStatus[5] || 0),
                vencidas,
            };
        })();

        const doc = new jsPDF("l");
        // Registrar DejaVu Sans (si está precargada) y monkey-patchear setFont
        // para que TODAS las llamadas a setFont('Helvetica',...) — incluidas las
        // internas de jspdf-autotable — caigan en DejaVu. Esto da soporte
        // Unicode completo (tildes, ñ, °, ⚠) tanto en el render como en el
        // texto extraíble del PDF (ToUnicode CMap correcto).
        registerDejavuOnDoc(doc);
        if (hasDejavuLoaded()) {
            const originalSetFont = doc.setFont.bind(doc);
            doc.setFont = function patchedSetFont(family, style, weight) {
                const fam = String(family || "").toLowerCase();
                if (fam === "helvetica" || fam === "arial") {
                    const wantBold = style === "bold" || style === "bolditalic";
                    const fonts = doc.getFontList();
                    const target = wantBold && fonts.DejaVuSans && fonts.DejaVuSans.includes("bold")
                        ? ["DejaVuSans", "bold"]
                        : ["DejaVuSans", "normal"];
                    return originalSetFont(target[0], target[1], weight);
                }
                return originalSetFont(family, style, weight);
            };
        }
        let logoData = null;
        if (cfg?.thumbnail) {
            try {
                const res = await fetch(cfg.thumbnail);
                const blob = await res.blob();
                logoData = await new Promise((resolve, reject) => {
                    const rd = new FileReader();
                    rd.onloadend = () => resolve(rd.result);
                    rd.onerror = reject;
                    rd.readAsDataURL(blob);
                });
            } catch (err) {
                console.error("No se pudo cargar el logo para el PDF", err);
            }
        }
        let firmaData = null;
        if (firmaEmpleado?.firmaElectronicaBase64) {
            try {
                const res = await fetch(firmaEmpleado.firmaElectronicaBase64);
                const blob = await res.blob();
                firmaData = await new Promise((resolve, reject) => {
                    const rd = new FileReader();
                    rd.onloadend = () => resolve(rd.result);
                    rd.onerror = reject;
                    rd.readAsDataURL(blob);
                });
            } catch (err) {
                console.error("No se pudo cargar la firma para el PDF", err);
            }
        }

        // Marcador de alerta: ⚠ requiere fuente Unicode (DejaVu). Sin DejaVu,
        // Helvetica lo renderiza como '&' que es semánticamente confuso para
        // un cliente externo. Usamos fallback ASCII "[!]" cuando no hay DejaVu.
        const alertMark = hasDejavuLoaded() ? "⚠" : "[!]";

        doc.setFontSize(16);
        doc.setFont("Helvetica", "bold");
        doc.text("Listado de Probetas", 14, 15);
        let yPos = 26;

        const baseInfo = [
            ["Fecha", dayjs().format("DD/MM/YYYY")],
            ["Productor", muestrasTerceros ? (productorHormigon || "—") : (cfg?.nombreEmpresa ?? "—")],
        ];

        const uniqueVal = (getter) => {
            const vals = probeList.map(getter).filter(v => v && v !== "—");
            return vals.length && new Set(vals).size === 1 ? vals[0] : null;
        };
        const extraInfo = [];
        const uCliente = uniqueVal(getCliente);
        if (uCliente) extraInfo.push(["Cliente", uCliente]);
        const uPlanta = uniqueVal(getPlanta);
        if (uPlanta) extraInfo.push(["Planta", uPlanta]);
        const uObra = uniqueVal(getObra);
        if (uObra) extraInfo.push(["Obra", uObra]);
        const uDos = uniqueVal(getDosif);
        if (uDos) extraInfo.push(["Dosificación", uDos]);
        const uTipo = uniqueVal(getTipo);
        if (uTipo) extraInfo.push(["Tipo H°", uTipo]);

        const includeCliente = showCliente && !uCliente;
        const includePlanta = showPlanta && !uPlanta;
        const includeObra = showObra && !uObra;
        const includeDosif = showDosificacion && !uDos;
        const includeTipo = showTipo && !uTipo;

        doc.setFontSize(13);
        doc.text("Información", 14, yPos);
        yPos += 4;
        doc.autoTable({ startY: yPos, body: [...baseInfo, ...extraInfo], theme: "grid", styles: { fontSize: 9 } });
        yPos = doc.autoTable.previous.finalY + 8;

        // KPIs row
        if (pdfStats) {
            const kpiData = [
                ["Total", String(pdfStats.total)],
                ["Curando", String(pdfStats.curando)],
                ["Pendientes", String(pdfStats.pendiente)],
                ["Ensayadas", String(pdfStats.ensayada)],
            ];
            if (pdfStats.vencidas > 0) kpiData.push(["Vencidas", String(pdfStats.vencidas)]);

            doc.autoTable({
                startY: yPos,
                head: [kpiData.map(k => k[0])],
                body: [kpiData.map(k => k[1])],
                theme: "grid",
                styles: { fontSize: 9, halign: "center" },
                headStyles: { fillColor: [155, 89, 182] },
                didParseCell: (data) => {
                    // Red highlight for "Vencidas" column
                    if (pdfStats.vencidas > 0 && data.column.index === kpiData.length - 1) {
                        if (data.section === 'head') data.cell.styles.fillColor = [231, 76, 60];
                        if (data.section === 'body') data.cell.styles.textColor = [231, 76, 60];
                    }
                },
            });
            yPos = doc.autoTable.previous.finalY + 4;
        }

        // Overdue alert
        if (pdfStats?.vencidas > 0) {
            doc.setFontSize(9);
            doc.setTextColor(192, 57, 43);
            doc.text(`${alertMark} ${pdfStats.vencidas} probeta${pdfStats.vencidas !== 1 ? 's' : ''} con fecha de rotura vencida.`, 14, yPos + 4);
            yPos += 5;
            doc.setFontSize(8);
            doc.setTextColor(127, 140, 141);
            doc.text("Según IRAM 1534, el ensayo debe realizarse dentro de las tolerancias establecidas para cada edad.", 14, yPos + 4);
            doc.setTextColor(0, 0, 0);
            yPos += 8;
        }

        yPos += 4;

        const hasVencidas = pdfStats?.vencidas > 0;

        const head = [
            "Nombre",
            "Código",
            ...(muestrasTerceros ? ["Remito"] : []),
            ...(includeCliente ? ["Cliente"] : []),
            ...(includeObra ? ["Obra"] : []),
            ...(includePlanta ? ["Planta"] : []),
            ...(includeDosif && !muestrasTerceros ? ["Dosificación"] : []),
            ...(includeTipo ? ["Tipo H°"] : []),
            "Observaciones",
            "Fecha confección",
            "Días rotura",
            "Rotura prevista",
            "Rotura real",
            ...(showResistencia ? ["Resistencia (MPa)"] : []),
            "Estado",
            ...(hasVencidas ? ["Días atraso"] : []),
        ];

        // Sort: vencidas first (mayor atraso), then pendientes by fecha próxima, then rest
        const sortedProbetas = [...probeList].sort((a, b) => {
            const aOver = isOverdue(a);
            const bOver = isOverdue(b);
            if (aOver && !bOver) return -1;
            if (!aOver && bOver) return 1;
            if (aOver && bOver) return diasAtraso(b) - diasAtraso(a);
            // Pendientes before ensayadas
            const aPend = a.idEstadoProbeta === 1 || a.idEstadoProbeta === 2;
            const bPend = b.idEstadoProbeta === 1 || b.idEstadoProbeta === 2;
            if (aPend && !bPend) return -1;
            if (!aPend && bPend) return 1;
            // By fechaRotura ascending
            if (a.fechaRotura && b.fechaRotura) return new Date(a.fechaRotura) - new Date(b.fechaRotura);
            return 0;
        });

        // Pre-compute overdue state per sorted row for PDF styling
        const overdueFlags = sortedProbetas.map((p) => isOverdue(p));

        const body = sortedProbetas.map((p) => {
            const overdue = isOverdue(p);
            const dias = diasAtraso(p);

            return [
                p.nombre,
                p.codigo || "—",
                ...(muestrasTerceros ? [p.muestraTerceros?.remito || "—"] : []),
                ...(includeCliente ? [getCliente(p)] : []),
                ...(includeObra ? [getObra(p)] : []),
                ...(includePlanta ? [getPlanta(p)] : []),
                ...(includeDosif && !muestrasTerceros ? [getDosif(p)] : []),
                ...(includeTipo ? [getTipo(p)] : []),
                p.observaciones || "—",
                formatFecha(getFechaConf(p)),
                p.diasRotura,
                formatFecha(p.fechaRotura),
                formatFecha(p.ensayo?.fechaEnsayo),
                ...(showResistencia ? [formatResistencia(p.ensayo?.resistencia)] : []),
                overdue ? "Vencida" : (estadoLabels[p.idEstadoProbeta] || "—"),
                ...(hasVencidas ? [overdue ? `${dias} días` : "—"] : []),
            ];
        });

        // Column indices for styling
        const rotPrevistaIdx = head.indexOf("Rotura prevista");
        const estadoIdx = head.indexOf("Estado");
        const diasAtrasoIdx = hasVencidas ? head.indexOf("Días atraso") : -1;

        doc.setFontSize(13);
        doc.text("Listado de probetas", 14, yPos);
        yPos += 4;
        doc.autoTable({
            startY: yPos,
            head: [head],
            body,
            styles: { fontSize: 9 },
            headStyles: { fillColor: [155, 89, 182] },
            didParseCell: (data) => {
                if (data.section === 'body' && overdueFlags[data.row.index]) {
                    data.cell.styles.fillColor = [253, 240, 239];
                    if (data.column.index === rotPrevistaIdx || data.column.index === estadoIdx || data.column.index === diasAtrasoIdx) {
                        data.cell.styles.textColor = [231, 76, 60];
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
            },
        });

        // IRAM 1534 tolerance footnote (preparación y curado de probetas)
        // lastContentY = posición Y donde realmente termina el contenido en la
        // última página. Arranca en finalY de la tabla y se incrementa con el
        // footnote si aplica. Es lo que usamos después para decidir si la
        // firma entra en la página actual o necesitamos una nueva.
        let lastContentY = doc.autoTable.previous.finalY;
        if (hasVencidas) {
            const footY = lastContentY + 5;
            doc.setFontSize(8);
            doc.setTextColor(192, 57, 43);
            doc.text(`${alertMark} Las probetas marcadas superaron su fecha de rotura prevista.`, 14, footY);
            doc.setTextColor(80, 80, 80);
            doc.text("Tolerancias de edad según IRAM 1534:", 14, footY + 4);
            doc.text("• 24 horas: ±0,5 h   • 3 días: ±2 h   • 7 días: ±6 h   • 28 días: ±20 h", 14, footY + 8);
            doc.text("Ensayos fuera de tolerancia pueden invalidar el resultado.", 14, footY + 12);
            doc.setTextColor(0, 0, 0);
            lastContentY = footY + 12;
        }

        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();

        // Bloque de firma: imagen + nombre + disclaimer + margen para footer.
        const firmaImgW = 50;
        const firmaImgH = 15;
        const FOOTER_RESERVE = 12; // espacio que reservamos para el "Página N/M"
        const firmaBlockH = firmaEmpleado && firmaData
            ? firmaImgH + 5 + 5 + (cfg?.nombreEmpresa ? 12 : 0)
            : 0;

        // Si hay firma, verificar que entre en la última página; si no, addPage().
        // Con muestras chicas (pocas probetas) la tabla termina alta y queda
        // espacio sobrado — antes el cálculo subestimaba el espacio disponible
        // y forzaba una página nueva casi vacía con solo la firma.
        if (firmaBlockH > 0) {
            const lastPage = doc.internal.getNumberOfPages();
            doc.setPage(lastPage);
            const spaceLeft = pageH - lastContentY - FOOTER_RESERVE;
            if (spaceLeft < firmaBlockH + 6) { // 6 = mínimo de aire entre contenido y firma
                doc.addPage();
            }
        }

        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            if (i === 1 && logoData) {
                doc.addImage(logoData, "PNG", pageW - 25, 10, 10, 10);
            }

            // Paginado
            doc.setFontSize(9);
            const footer = `Página ${i}/${totalPages}`;
            const txtW = doc.getTextWidth(footer);
            doc.text(footer, pageW - txtW - 10, pageH - 7);

            // Firma solo en la última página
            if (i === totalPages && firmaEmpleado && firmaData) {
                // Posicionar desde abajo hacia arriba
                let yBottom = pageH - 8; // margen inferior base

                // Disclaimer (pegado al nombre)
                if (cfg?.nombreEmpresa) {
                    doc.setFontSize(8);
                    const disclaimer = `${cfg.nombreEmpresa} no se responsabiliza por el mal uso o interpretación del presente informe.`;
                    const lines = doc.splitTextToSize(disclaimer, pageW - 40);
                    doc.text(lines, pageW / 2, yBottom, { align: "center" });
                    yBottom -= (lines.length * 4) + 1;
                }

                // Nombre del empleado
                doc.setFontSize(10);
                const nombre = `${firmaEmpleado.apellido}, ${firmaEmpleado.nombre}`;
                doc.text(nombre, pageW / 2, yBottom, { align: "center" });
                yBottom -= 5;

                // Imagen de firma (un poco más separada del nombre)
                const yFirma = yBottom - firmaImgH;
                doc.addImage(firmaData, "PNG", (pageW - firmaImgW) / 2, yFirma, firmaImgW, firmaImgH);

                doc.setFontSize(9);
            }
        }
        const clienteNombre = appliedFilters.idCliente
            ? (probeList.length > 0 ? getCliente(probeList[0]) : "Cliente")
            : "Todos";
        const safeCliente = (clienteNombre || "Cliente")
            .toString()
            .trim()
            .replace(/\s+/g, " ")
            .replace(/[\\/*?"<>|]+/g, "");
        const fechaHora = dayjs().format("DD-MM-YYYY HH:mm");
        doc.save(`Listado Probetas ${safeCliente} ${fechaHora}.pdf`);
    };

    // Status badge template — muestra siempre el estado real (Curando, Pendiente,
    // Ensayada, …) y agrega un chip auxiliar "Vencida" cuando corresponde, para
    // no ocultar la información de fondo (PROB-06).
    //
    // Sesión 2026-05-10: agregamos un chip auxiliar "Sin registro" cuando una
    // probeta está marcada como Ensayada (idEstadoProbeta === 3) pero NO tiene
    // EnsayoResistencia asociado. Eso pasa típicamente con data legacy
    // importada incompleta — el usuario debe saber que falta cargar el
    // resultado real.
    const statusTemplate = (p) => {
        const overdue = isOverdue(p);
        const statusClass = estadoClassMap[p.idEstadoProbeta] || "rpt-status-badge--perdida";
        const ensayadaSinRegistro = p.idEstadoProbeta === 3 && !p.ensayo;
        return (
            <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                <span className={`rpt-status-badge ${statusClass}`}>
                    {estadoLabels[p.idEstadoProbeta] || "—"}
                </span>
                {overdue && (
                    <span
                        className="rpt-status-badge rpt-status-badge--vencida"
                        title={`Rotura prevista hace ${diasAtraso(p)} días`}
                    >
                        Vencida
                    </span>
                )}
                {ensayadaSinRegistro && (
                    <span
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 6px',
                            fontSize: '0.75em',
                            fontWeight: 600,
                            background: 'var(--orange-100, #ffe0b2)',
                            color: 'var(--orange-900, #7a4a00)',
                            borderRadius: 3,
                            border: '1px solid var(--orange-300, #ffb74d)',
                        }}
                        title="La probeta está marcada como Ensayada pero no tiene resultado de ensayo cargado en el sistema. Posible data importada de manera incompleta. Cargar el resultado real desde el formulario de ensayo."
                    >
                        <i className="fa-solid fa-triangle-exclamation" />
                        Sin registro
                    </span>
                )}
            </span>
        );
    };

    return (
        <div className="reports-module p-0 pt-3">
            {/* Overlay móvil */}
            <div
                className={`rpt-mobile-overlay ${filterVisible ? 'visible' : ''}`}
                onClick={() => setFilterVisible(false)}
            />

            {/* Botón flotante móvil */}
            <button
                className="rpt-mobile-filter-btn rpt-mobile-filter-btn--probetas"
                onClick={() => setFilterVisible(true)}
            >
                <i className="fa-solid fa-sliders" />
            </button>

            {/* Panel de Filtros */}
            <ProbetasFilter
                visible={filterVisible}
                setVisible={setFilterVisible}
                tempFilters={tempFilters}
                dispatch={dispatch}
                handleApplyFilters={applyFilters}
                handleClearAllFilters={clearAllFilters}
                exportToExcel={exportToExcel}
                exportToPDF={handlePreviewPDF}
                showCliente={showCliente}
                setShowCliente={setShowCliente}
                showDosificacion={showDosificacion}
                setShowDosificacion={setShowDosificacion}
                showPlanta={showPlanta}
                setShowPlanta={setShowPlanta}
                showObra={showObra}
                setShowObra={setShowObra}
                showSabana={showSabana}
                setShowSabana={setShowSabana}
                showResistencia={showResistencia}
                setShowResistencia={setShowResistencia}
                muestrasTerceros={muestrasTerceros}
                setMuestrasTerceros={setMuestrasTerceros}
                tipoFecha={tipoFecha}
                setTipoFecha={setTipoFecha}
            />

            {/* Panel Principal */}
            <div className="rpt-main-panel">
                {/* Header */}
                <div className="rpt-report-header">
                    <h1 className="rpt-report-title">
                        <span className="rpt-report-title-icon rpt-report-title-icon--probetas">
                            <i className="fa-solid fa-vials" />
                        </span>
                        Listado de Probetas
                    </h1>
                    {probetas.length > 0 && (
                        <span className="rpt-report-badge rpt-report-badge--probetas">
                            <i className="fa-solid fa-flask" />
                            {probetas.length} probeta{probetas.length !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>

                {/* Stats cards */}
                {stats && !loading && (
                    <div className="rpt-stats-row">
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Total</p>
                            <p className="rpt-stat-value">{stats.total}</p>
                        </div>
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Curando</p>
                            <p className="rpt-stat-value" style={{ color: 'var(--blue-500)' }}>{stats.curando}</p>
                        </div>
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Pendientes</p>
                            <p className="rpt-stat-value" style={{ color: 'var(--orange-500)' }}>{stats.pendiente}</p>
                        </div>
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Ensayadas</p>
                            <p className="rpt-stat-value" style={{ color: 'var(--green-500)' }}>{stats.ensayada}</p>
                        </div>
                        {stats.vencidas > 0 && (
                            <div className="rpt-stat-card" style={{ borderLeft: '4px solid #e74c3c' }}>
                                <p className="rpt-stat-label">Vencidas</p>
                                <p className="rpt-stat-value" style={{ color: 'var(--red-500)' }}>{stats.vencidas}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Alerta de probetas vencidas */}
                {stats?.vencidas > 0 && !loading && (
                    <div className="rpt-alert-overdue">
                        <i className="fa-solid fa-triangle-exclamation rpt-alert-overdue__icon" />
                        <span className="rpt-alert-overdue__title">
                            {stats.vencidas} probeta{stats.vencidas !== 1 ? 's' : ''} con fecha de rotura vencida.
                        </span>
                        <span className="rpt-alert-overdue__hint">
                            Según IRAM 1534, el ensayo debe realizarse dentro de las tolerancias establecidas para cada edad.
                        </span>
                    </div>
                )}

                {/* Contenido principal */}
                {loading ? (
                    <div className="rpt-loading">
                        <LoadSpinner />
                    </div>
                ) : probetas.length > 0 ? (
                    <div className="rpt-table-card w-full">
                        <div className="rpt-table-header">
                            <h3 className="rpt-table-title">
                                <i className="fa-solid fa-list rpt-table-title-icon rpt-table-title-icon--probetas" />
                                Detalle de probetas
                            </h3>
                            <span className="rpt-table-count">
                                {probetas.length} registro{probetas.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="rpt-datatable">
                            <DataTable
                                value={probetas}
                                paginator
                                rows={50}
                                rowsPerPageOptions={[50, 100, 200]}
                                first={tableFirst}
                                onPage={(e) => setTableFirst(e.first)}
                                scrollable
                                rowClassName={(p) => isOverdue(p) ? 'rpt-row-overdue' : ''}
                                emptyMessage={
                                    <div className="rpt-empty-state" style={{ padding: '2rem' }}>
                                        <p>Sin registros</p>
                                    </div>
                                }
                            >
                                <Column field="nombre" header="Nombre" sortable />
                                {showCliente && (
                                    <Column header="Cliente" body={getCliente} sortable />
                                )}
                                {showObra && (
                                    <Column header="Obra" body={getObra} sortable />
                                )}
                                {showPlanta && (
                                    <Column header="Planta" body={getPlanta} sortable />
                                )}
                                {showDosificacion && (
                                    <Column header="Dosificación" body={getDosif} sortable />
                                )}
                                {showTipo && (
                                    <Column header="Tipo H°" body={getTipo} sortable />
                                )}
                                <Column
                                    header="Rotura prevista"
                                    body={(p) => {
                                        const overdue = isOverdue(p);
                                        const dias = diasAtraso(p);
                                        return (
                                            <span>
                                                {formatFecha(p.fechaRotura)}
                                                {overdue && (
                                                    <span style={{ color: 'var(--red-500)', fontWeight: 600, marginLeft: 6, fontSize: '0.85em' }}>
                                                        ({dias}d atraso)
                                                    </span>
                                                )}
                                            </span>
                                        );
                                    }}
                                    sortable
                                    field="fechaRotura"
                                />
                                <Column
                                    header="Rotura real"
                                    body={(p) => {
                                        if (p.ensayo?.fechaEnsayo) return formatFecha(p.ensayo.fechaEnsayo);
                                        if (p.idEstadoProbeta === 3) {
                                            // Probeta marcada Ensayada pero sin EnsayoResistencia
                                            // — data legacy incompleta. La etiquetamos en lugar
                                            // de dejar el "—" mudo.
                                            return (
                                                <span
                                                    style={{ color: 'var(--orange-700, #c8742a)', fontStyle: 'italic', fontSize: '0.85em' }}
                                                    title="La probeta figura como Ensayada pero no tiene resultado cargado. Falta el registro del ensayo."
                                                >
                                                    sin registro
                                                </span>
                                            );
                                        }
                                        return formatFecha(null);
                                    }}
                                    sortable
                                />
                                {showResistencia && (
                                    <Column
                                        header="Resistencia (MPa)"
                                        body={(p) => formatResistencia(p.ensayo?.resistencia)}
                                        sortable
                                    />
                                )}
                                <Column
                                    header="Estado"
                                    body={statusTemplate}
                                    sortable
                                    field="idEstadoProbeta"
                                />
                            </DataTable>
                        </div>
                    </div>
                ) : (
                    <div className="rpt-empty-state">
                        <div className="rpt-empty-state-icon">
                            <i className="fa-solid fa-flask" />
                        </div>
                        <h2 className="rpt-empty-state-title">Sin probetas</h2>
                        <p className="rpt-empty-state-text">
                            No se encontraron registros con los filtros seleccionados. Probá ajustando los criterios de búsqueda.
                        </p>
                    </div>
                )}
            </div>

            {/* Dialog de preview/selección de probetas para PDF */}
            <Dialog
                visible={previewVisible}
                onHide={() => setPreviewVisible(false)}
                header={
                    <span>
                        <i className="fa-solid fa-list-check" style={{ marginRight: 8 }} />
                        Seleccionar probetas para el informe
                    </span>
                }
                style={{ width: '95vw', maxWidth: '1400px' }}
                dismissableMask
                modal
                className="rpt-pdf-dialog"
            >
                <div style={{ padding: '1rem 1.5rem' }}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '1rem',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                    }}>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <Button
                                label="Seleccionar todas"
                                icon="fa-solid fa-check-double"
                                className="p-button-outlined p-button-sm"
                                onClick={() => setSelectedProbetas([...probetas])}
                            />
                            <Button
                                label="Deseleccionar todas"
                                icon="fa-solid fa-xmark"
                                className="p-button-outlined p-button-secondary p-button-sm"
                                onClick={() => setSelectedProbetas([])}
                            />
                        </div>
                        <span style={{
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            color: 'var(--rpt-text-secondary)',
                        }}>
                            {selectedProbetas.length} de {probetas.length} probeta{probetas.length !== 1 ? 's' : ''} seleccionada{selectedProbetas.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                    <DataTable
                        value={probetas}
                        selection={selectedProbetas}
                        onSelectionChange={(e) => setSelectedProbetas(e.value)}
                        dataKey="idProbeta"
                        paginator
                        rows={25}
                        rowsPerPageOptions={[25, 50, 100]}
                        first={previewFirst}
                        onPage={(e) => setPreviewFirst(e.first)}
                        scrollable
                        scrollHeight="55vh"
                        size="small"
                        emptyMessage="Sin probetas"
                        rowClassName={(p) => isOverdue(p) ? 'rpt-row-overdue' : ''}
                    >
                        <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} />
                        <Column field="nombre" header="Nombre" sortable style={{ minWidth: '100px' }} />
                        <Column field="codigo" header="Código" sortable body={(p) => p.codigo || "—"} style={{ minWidth: '100px' }} />
                        <Column header="Cliente" body={getCliente} sortable style={{ minWidth: '120px' }} />
                        <Column header="Obra" body={getObra} sortable style={{ minWidth: '110px' }} />
                        <Column header="Planta" body={getPlanta} sortable style={{ minWidth: '100px' }} />
                        {!muestrasTerceros && (
                            <Column header="Dosificación" body={getDosif} sortable style={{ minWidth: '110px' }} />
                        )}
                        <Column header="Tipo H°" body={getTipo} sortable style={{ minWidth: '90px' }} />
                        <Column
                            header="F. Confección"
                            body={(p) => formatFecha(getFechaConf(p))}
                            sortable
                            style={{ minWidth: '110px' }}
                        />
                        <Column field="diasRotura" header="Días rot." sortable style={{ minWidth: '80px' }} />
                        <Column
                            header="Rotura prevista"
                            body={(p) => formatFecha(p.fechaRotura)}
                            sortable
                            field="fechaRotura"
                            style={{ minWidth: '120px' }}
                        />
                        <Column
                            header="Rotura real"
                            body={(p) => formatFecha(p.ensayo?.fechaEnsayo)}
                            sortable
                            style={{ minWidth: '110px' }}
                        />
                        <Column
                            header="Estado"
                            body={statusTemplate}
                            sortable
                            field="idEstadoProbeta"
                            style={{ minWidth: '100px' }}
                        />
                        <Column
                            field="observaciones"
                            header="Observación"
                            sortable
                            body={(p) => (
                                <span title={p.observaciones || ""} style={{
                                    maxWidth: '200px',
                                    display: 'inline-block',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {p.observaciones || "—"}
                                </span>
                            )}
                            style={{ minWidth: '150px', maxWidth: '200px' }}
                        />
                    </DataTable>
                </div>
                <div className="rpt-pdf-dialog-footer">
                    <Button
                        label="Cancelar"
                        icon="fa-solid fa-times"
                        className="p-button-text p-button-secondary"
                        onClick={() => setPreviewVisible(false)}
                        style={{ marginRight: '0.5rem' }}
                    />
                    <Button
                        label={`Generar PDF (${selectedProbetas.length})`}
                        icon="fa-solid fa-file-pdf"
                        onClick={handleGeneratePDF}
                        disabled={selectedProbetas.length === 0}
                    />
                </div>
            </Dialog>
        </div>
    );
};

export default ReportProbetas;