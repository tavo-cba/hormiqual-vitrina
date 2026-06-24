import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import { formatNumber } from '../../../lib/format';

/**
 * Exportadores PDF y Excel para Control Estadístico (Carta de Control
 * de Shewhart + reglas Western Electric + histograma).
 *
 * PDF: jsPDF + jspdf-autotable client-side (regla de stack HormiQual).
 * Excel: xlsx client-side (consistente con otros reportes).
 *
 * El chart se exporta como imagen (toBase64Image) si se le pasa la
 * ref del PrimeReact Chart; si viene null, se exporta sin imagen.
 *
 * El PR9 NO aplica acá (es control sobre probetas ya colocadas, no
 * sobre aptitud de materiales). Por eso no recibe `modoEvaluacion`
 * ni muestra banner del modelo dual.
 */

const fmt = (v, p = 2) => v == null ? '—' : formatNumber(v, { precision: p });

const ruleLabel = (rule) => {
    // Western Electric (Nelson 1984 adaptado): 1=outside ±3s, 2=2/3 outside ±2s,
    // 3=4/5 outside ±1s, 4=8 consecutive on one side of mean.
    if (rule === 1) return 'Regla 1 (fuera ±3s)';
    if (rule === 2) return 'Regla 2 (2/3 fuera ±2s)';
    if (rule === 3) return 'Regla 3 (4/5 fuera ±1s)';
    if (rule === 4) return 'Regla 4 (8 consecutivos en un lado)';
    return `Regla ${rule}`;
};

const tipoLabel = (tipos, id) => {
    if (!id) return 'Todos';
    const t = tipos.find((x) => x.value === id);
    return t ? t.label : `#${id}`;
};

const modoLabel = (modo) => (modo === 'normalizado' ? '% del objetivo' : 'MPa absoluto');

/* ───────── PDF ───────── */

export async function exportControlPDF({
    data,
    selectedEdad,
    filters,
    tipos,
    westernElectric,
    cpk,
    chartImageDataUrl,
    configEmpresa = {},
}) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 12;
    let y = margin;

    const currentData = data?.[`edad${selectedEdad}`];
    const stats = currentData?.stats;
    const points = currentData?.points || [];
    const isNormMode = data?.modo === 'normalizado';
    const unitLabel = isNormMode ? '% obj.' : 'MPa';

    /* Header */
    if (configEmpresa.thumbnail) {
        try {
            doc.addImage(configEmpresa.thumbnail, 'PNG', margin, y, 18, 18);
        } catch { /* ignore broken logo */ }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Carta de Control Estadístico', pageW / 2, y + 6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(configEmpresa.nombreEmpresa || '', pageW / 2, y + 11, { align: 'center' });
    doc.text(`Generado: ${dayjs().format('DD/MM/YYYY HH:mm')}`, pageW - margin, y + 6, { align: 'right' });
    y += 22;

    /* Filtros */
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Filtros aplicados', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    y += 5;
    const filtrosTxt = [
        `Tipo de hormigón: ${tipoLabel(tipos, filters.idTipoHormigon)}`,
        `Edad: ${selectedEdad} días`,
        `Modo: ${modoLabel(data?.modo)}`,
        `Desde: ${filters.desde ? dayjs(filters.desde).format('DD/MM/YYYY') : '—'}`,
        `Hasta: ${filters.hasta ? dayjs(filters.hasta).format('DD/MM/YYYY') : '—'}`,
    ];
    filtrosTxt.forEach((t) => { doc.text(t, margin, y); y += 4; });
    y += 2;

    /* Stats */
    if (stats) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Estadísticos del proceso', margin, y);
        y += 2;

        const statRows = [
            ['n', String(stats.n ?? '—')],
            [`Media (${unitLabel})`, fmt(stats.mean)],
            [`Desvío s (${unitLabel})`, fmt(stats.sd)],
            [`UCL 3s (${unitLabel})`, fmt(stats.ucl)],
            [`LCL 3s (${unitLabel})`, fmt(stats.lcl)],
            ['Violaciones Western Electric', String(westernElectric?.length ?? 0)],
        ];
        if (cpk) {
            statRows.push([`Cpk inferior (LSL=${fmt(cpk.lsl)} ${unitLabel})`, `${fmt(cpk.cpkL)} (${cpk.nivel})`]);
        }
        doc.autoTable({
            startY: y + 2,
            head: [['Indicador', 'Valor']],
            body: statRows,
            theme: 'striped',
            styles: { fontSize: 8, cellPadding: 1.5 },
            headStyles: { fillColor: [59, 130, 246] },
            margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 5;
    }

    /* Banner WE si hay violaciones */
    if (westernElectric?.length > 0) {
        doc.setFillColor(254, 243, 199); // amber-100
        doc.setDrawColor(245, 158, 11);  // amber-500
        doc.roundedRect(margin, y, pageW - margin * 2, 10, 1, 1, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(180, 83, 9); // amber-700
        doc.text(
            `[!]  ${westernElectric.length} violación(es) de Western Electric — proceso fuera de control estadístico.`,
            margin + 3,
            y + 6,
        );
        doc.setTextColor(0, 0, 0);
        y += 14;
    }

    /* Chart */
    if (chartImageDataUrl) {
        const w = pageW - margin * 2;
        const h = w * 0.45; // proporción legible
        if (y + h > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage();
            y = margin;
        }
        try {
            doc.addImage(chartImageDataUrl, 'PNG', margin, y, w, h);
            y += h + 5;
        } catch (err) {
            console.warn('No se pudo embeber el chart:', err);
        }
    }

    /* Violaciones WE detalladas */
    if (westernElectric?.length > 0) {
        if (y + 30 > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage();
            y = margin;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Violaciones Western Electric', margin, y);
        y += 2;
        doc.autoTable({
            startY: y + 2,
            head: [['#', 'Regla', 'Fecha', 'Tipo', 'Valor', 'Target']],
            body: westernElectric.map((w) => {
                const p = points[w.index];
                return [
                    String(w.index + 1),
                    ruleLabel(w.rule),
                    p?.fecha ?? '—',
                    p?.tipoHormigon ?? '—',
                    fmt(p?.valor ?? p?.resistencia),
                    fmt(p?.target),
                ];
            }),
            theme: 'striped',
            styles: { fontSize: 7.5, cellPadding: 1.5 },
            headStyles: { fillColor: [220, 38, 38] },
            margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 5;
    }

    /* Tabla de datos (max 100 filas en PDF para evitar PDFs gigantes;
       el Excel exporta todo) */
    if (points.length > 0) {
        if (y + 30 > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage();
            y = margin;
        }
        const limit = Math.min(points.length, 100);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(
            `Datos del control${points.length > limit ? ` (primeros ${limit} de ${points.length})` : ''}`,
            margin,
            y,
        );
        y += 2;
        const violationIdxSet = new Set((westernElectric || []).map((w) => w.index));
        doc.autoTable({
            startY: y + 2,
            head: [['#', 'Fecha', 'Tipo H°', `Valor (${unitLabel})`, 'Target', 'Remito', 'WE']],
            body: points.slice(0, limit).map((p, i) => [
                String(i + 1),
                p.fecha ?? '—',
                p.tipoHormigon ?? '—',
                fmt(p.valor ?? p.resistencia),
                fmt(p.target),
                p.remito ?? '—',
                violationIdxSet.has(i) ? 'X' : '',
            ]),
            theme: 'grid',
            styles: { fontSize: 7, cellPadding: 1 },
            headStyles: { fillColor: [59, 130, 246] },
            didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 6 && data.cell.raw === 'X') {
                    data.cell.styles.textColor = [220, 38, 38];
                    data.cell.styles.fontStyle = 'bold';
                }
            },
            margin: { left: margin, right: margin },
        });
    }

    /* Footer paginación */
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(120, 120, 120);
        doc.text(
            `Página ${i} de ${pageCount}`,
            pageW - margin,
            doc.internal.pageSize.getHeight() - 5,
            { align: 'right' },
        );
        doc.text(
            'HormiQual — Carta de Control · CIRSOC 200:2024 §6.2 / IRAM 1666:2020 §A.7',
            margin,
            doc.internal.pageSize.getHeight() - 5,
        );
        doc.setTextColor(0, 0, 0);
    }

    const safeFilters = [
        tipoLabel(tipos, filters.idTipoHormigon).replace(/[^a-z0-9-]+/gi, '_').slice(0, 20),
        `${selectedEdad}d`,
        data?.modo === 'normalizado' ? 'norm' : 'mpa',
    ].filter(Boolean).join('_');
    const fileName = `Control_Estadistico_${safeFilters}_${dayjs().format('YYYYMMDD_HHmm')}.pdf`;
    doc.save(fileName);
}

/* ───────── Excel ───────── */

export function exportControlExcel({
    data,
    selectedEdad,
    filters,
    tipos,
    westernElectric,
    cpk,
}) {
    const wb = XLSX.utils.book_new();
    const currentData = data?.[`edad${selectedEdad}`];
    const stats = currentData?.stats;
    const points = currentData?.points || [];
    const isNormMode = data?.modo === 'normalizado';
    const unitLabel = isNormMode ? '% obj.' : 'MPa';

    /* Hoja 1: Resumen */
    const resumenRows = [
        ['Carta de Control Estadístico'],
        ['Generado', dayjs().format('DD/MM/YYYY HH:mm')],
        [],
        ['Filtros aplicados'],
        ['Tipo de hormigón', tipoLabel(tipos, filters.idTipoHormigon)],
        ['Edad', `${selectedEdad} días`],
        ['Modo', modoLabel(data?.modo)],
        ['Desde', filters.desde ? dayjs(filters.desde).format('DD/MM/YYYY') : '—'],
        ['Hasta', filters.hasta ? dayjs(filters.hasta).format('DD/MM/YYYY') : '—'],
        [],
    ];
    if (stats) {
        resumenRows.push(['Estadísticos del proceso'],
            ['Indicador', 'Valor', 'Unidad'],
            ['n', stats.n ?? '', ''],
            ['Media', stats.mean ?? '', unitLabel],
            ['Desvío estándar (s)', stats.sd ?? '', unitLabel],
            ['UCL (3s)', stats.ucl ?? '', unitLabel],
            ['LCL (3s)', stats.lcl ?? '', unitLabel],
            ['Violaciones Western Electric', westernElectric?.length ?? 0, ''],
        );
        if (cpk) {
            resumenRows.push(
                ['Cpk inferior', cpk.cpkL, ''],
                ['LSL utilizado', cpk.lsl, unitLabel],
                ['Nivel del Cpk', cpk.nivel, ''],
            );
        }
    }
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    /* Hoja 2: Violaciones WE */
    if (westernElectric?.length > 0) {
        const rows = [
            ['#', 'Regla', 'Descripción', 'Fecha', 'Tipo H°', `Valor (${unitLabel})`, 'Target', 'Remito'],
            ...westernElectric.map((w) => {
                const p = points[w.index];
                return [
                    w.index + 1,
                    w.rule,
                    ruleLabel(w.rule),
                    p?.fecha ?? '',
                    p?.tipoHormigon ?? '',
                    p?.valor ?? p?.resistencia ?? '',
                    p?.target ?? '',
                    p?.remito ?? '',
                ];
            }),
        ];
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Violaciones WE');
    }

    /* Hoja 3: Datos */
    if (points.length > 0) {
        const violationsByIdx = new Map();
        (westernElectric || []).forEach((w) => {
            const arr = violationsByIdx.get(w.index) || [];
            arr.push(w.rule);
            violationsByIdx.set(w.index, arr);
        });
        const rows = [
            ['#', 'Fecha', 'Tipo H°', `Valor (${unitLabel})`, 'Target', 'Remito', 'Violaciones WE'],
            ...points.map((p, i) => [
                i + 1,
                p.fecha ?? '',
                p.tipoHormigon ?? '',
                p.valor ?? p.resistencia ?? '',
                p.target ?? '',
                p.remito ?? '',
                (violationsByIdx.get(i) || []).join(', '),
            ]),
        ];
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    }

    const safeFilters = [
        tipoLabel(tipos, filters.idTipoHormigon).replace(/[^a-z0-9-]+/gi, '_').slice(0, 20),
        `${selectedEdad}d`,
        data?.modo === 'normalizado' ? 'norm' : 'mpa',
    ].filter(Boolean).join('_');
    const fileName = `Control_Estadistico_${safeFilters}_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`;
    XLSX.writeFile(wb, fileName);
}
