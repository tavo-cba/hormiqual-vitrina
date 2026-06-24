import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import { formatNumber } from '../../../lib/format';

/**
 * Exportadores PDF y Excel del Tablero de Calidad (dos vistas: tenant
 * cross-planta y planta operativa). Cada vista tiene su par de funciones
 * porque los shapes de datos son distintos.
 *
 * PDF: jsPDF + jspdf-autotable cliente (regla stack HormiQual).
 * Excel: xlsx cliente.
 *
 * PR9 NO aplica al Tablero (es panorama de probetas colocadas, no
 * aptitud de materiales/dosificaciones). No recibe `modoEvaluacion`.
 */

const fmt = (v, p = 2) => v == null ? '—' : formatNumber(v, { precision: p });

const tipoLabel = (tipos, id) => {
    if (!id) return 'Todos';
    const t = tipos?.find?.((x) => x.value === id);
    return t ? t.label : `#${id}`;
};

const ESTADO_LABEL = {
    BORRADOR: 'Borrador',
    A_PRUEBA: 'A prueba',
    PENDIENTE_REVISION: 'Pendiente revisión',
    APROBADO: 'Aprobado',
    SUSPENDIDO: 'Suspendido',
    ARCHIVADO: 'Archivado',
};

/* ───────── Helpers comunes ───────── */

function pdfHeader(doc, { titulo, configEmpresa = {} }) {
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 12;
    if (configEmpresa.thumbnail) {
        try { doc.addImage(configEmpresa.thumbnail, 'PNG', margin, margin, 18, 18); } catch { /* */ }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(titulo, pageW / 2, margin + 6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(configEmpresa.nombreEmpresa || '', pageW / 2, margin + 11, { align: 'center' });
    doc.text(`Generado: ${dayjs().format('DD/MM/YYYY HH:mm')}`, pageW - margin, margin + 6, { align: 'right' });
    return margin + 22;
}

function pdfFooter(doc, leyenda) {
    const pageCount = doc.internal.getNumberOfPages();
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(120, 120, 120);
        doc.text(`Página ${i} de ${pageCount}`, pageW - 12, pageH - 5, { align: 'right' });
        if (leyenda) doc.text(leyenda, 12, pageH - 5);
        doc.setTextColor(0, 0, 0);
    }
}

/* ═══════════════════════════════════════════════════════
   Vista GENERAL (consolidada, todas las plantas)
   La función conserva el nombre `exportTenantPDF/Excel`
   internamente por consistencia con el componente fuente
   (`TableroTenantView`), pero el texto y los nombres de
   archivo visibles al usuario usan "general" — "tenant" es
   jerga interna del multi-tenant. Regla documentada en
   `CLAUDE.md` raíz §"Terminología visible al usuario".
   ═══════════════════════════════════════════════════════ */

export async function exportTenantPDF({ data, filters, tipos, alertCount, alertasPendientes, configEmpresa = {} }) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 12;
    let y = pdfHeader(doc, { titulo: 'Tablero de Calidad — Vista general', configEmpresa });

    /* Filtros */
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Filtros aplicados', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    y += 5;
    [
        `Tipo de hormigón: ${tipoLabel(tipos, filters.idTipoHormigon)}`,
        `Desde: ${filters.desde ? dayjs(filters.desde).format('DD/MM/YYYY') : '—'}`,
        `Hasta: ${filters.hasta ? dayjs(filters.hasta).format('DD/MM/YYYY') : '—'}`,
    ].forEach((t) => { doc.text(t, margin, y); y += 4; });
    y += 2;

    /* KPIs */
    const k = data?.kpis || {};
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Indicadores clave', margin, y);
    y += 2;
    doc.autoTable({
        startY: y + 2,
        head: [['Indicador', 'Valor']],
        body: [
            ['Total muestras', k.totalMuestras ?? '—'],
            ['Total probetas', k.totalProbetas ?? '—'],
            ['Total ensayos', k.totalEnsayos ?? '—'],
            ['Cumplimiento 28d', k.cumplimiento28d != null ? `${k.cumplimiento28d}%` : '—'],
            ['Peor tipo', k.peorTipo ? `${k.peorTipo.tipo} (${k.peorTipo.cumplimiento}%)` : '—'],
            ['Tipos bajo control', k.totalTipos > 0 ? `${k.tiposBajoControl}/${k.totalTipos}` : '—'],
            ['Alertas pendientes', alertCount ?? 0],
        ],
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [59, 130, 246] },
        margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 5;

    /* Alertas */
    if (alertasPendientes?.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Alertas pendientes (top)', margin, y);
        y += 2;
        doc.autoTable({
            startY: y + 2,
            head: [['Nivel', 'Material', 'Mensaje']],
            body: alertasPendientes.slice(0, 20).map((a) => [
                a.nivel ?? '—',
                a.nombreMaterial ?? '—',
                a.mensaje ?? '—',
            ]),
            theme: 'striped',
            styles: { fontSize: 7.5, cellPadding: 1.5 },
            headStyles: { fillColor: [245, 158, 11] },
            columnStyles: { 2: { cellWidth: 'auto' } },
            margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 5;
    }

    /* Resumen por tipo */
    if (data?.summaryByTipo?.length > 0) {
        if (y + 30 > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Resumen por tipo de hormigón', margin, y);
        y += 2;
        doc.autoTable({
            startY: y + 2,
            head: [['Tipo', 'n', 'Media', 'Desvío', 'CV %', "f'ck", 'Mín', 'Máx', 'Cumpl. %']],
            body: data.summaryByTipo.map((r) => [
                r.tipoHormigon ?? '—',
                r.n ?? 0,
                fmt(r.media),
                fmt(r.desvio),
                fmt(r.cv, 1),
                fmt(r.fck),
                fmt(r.min),
                fmt(r.max),
                r.cumplimiento != null ? `${r.cumplimiento}%` : '—',
            ]),
            theme: 'striped',
            styles: { fontSize: 7.5, cellPadding: 1.5 },
            headStyles: { fillColor: [16, 185, 129] },
            margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 5;
    }

    /* Evolución */
    if (data?.evolution?.series?.length > 0) {
        if (y + 30 > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
        const norm = data.evolution.normalizado;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(`Evolución mensual 28d${norm ? ' (% del objetivo)' : ''}`, margin, y);
        y += 2;
        doc.autoTable({
            startY: y + 2,
            head: [['Mes', `Media${norm ? ' (%)' : ' (MPa)'}`, norm ? '—' : "f'ck", 'CV (%)', 'n']],
            body: data.evolution.series.map((e) => [
                e.label ?? '—',
                fmt(e.media),
                norm ? '—' : fmt(e.fck),
                fmt(e.cv, 1),
                e.n ?? '—',
            ]),
            theme: 'striped',
            styles: { fontSize: 7.5, cellPadding: 1.5 },
            headStyles: { fillColor: [139, 92, 246] },
            margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 5;
    }

    /* Actividad reciente */
    if (data?.recentActivity?.length > 0) {
        if (y + 30 > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
        const limit = Math.min(data.recentActivity.length, 50);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(
            `Actividad reciente${data.recentActivity.length > limit ? ` (primeras ${limit} de ${data.recentActivity.length})` : ''}`,
            margin,
            y,
        );
        y += 2;
        doc.autoTable({
            startY: y + 2,
            head: [['Fecha', 'Probeta', 'Remito', 'Tipo H°', 'Edad', 'Resist. (MPa)', 'Estado']],
            body: data.recentActivity.slice(0, limit).map((r) => [
                r.fechaEnsayo ?? '—',
                r.probeta ?? '—',
                r.remito ?? '—',
                r.tipoHormigon ?? '—',
                r.edadEnsayo ?? '—',
                fmt(r.resistencia),
                r.pendiente ? 'Pendiente' : 'Revisado',
            ]),
            theme: 'grid',
            styles: { fontSize: 7, cellPadding: 1 },
            headStyles: { fillColor: [59, 130, 246] },
            margin: { left: margin, right: margin },
        });
    }

    pdfFooter(doc, 'HormiQual — Tablero de Calidad · CIRSOC 200:2024 / IRAM 1666:2020');
    doc.save(`Tablero_General_${dayjs().format('YYYYMMDD_HHmm')}.pdf`);
}

export function exportTenantExcel({ data, filters, tipos, alertCount, alertasPendientes }) {
    const wb = XLSX.utils.book_new();

    /* Hoja KPIs */
    const k = data?.kpis || {};
    const resumenRows = [
        ['Tablero de Calidad — Vista general'],
        ['Generado', dayjs().format('DD/MM/YYYY HH:mm')],
        [],
        ['Filtros aplicados'],
        ['Tipo de hormigón', tipoLabel(tipos, filters.idTipoHormigon)],
        ['Desde', filters.desde ? dayjs(filters.desde).format('DD/MM/YYYY') : '—'],
        ['Hasta', filters.hasta ? dayjs(filters.hasta).format('DD/MM/YYYY') : '—'],
        [],
        ['Indicadores clave'],
        ['Indicador', 'Valor'],
        ['Total muestras', k.totalMuestras ?? ''],
        ['Total probetas', k.totalProbetas ?? ''],
        ['Total ensayos', k.totalEnsayos ?? ''],
        ['Cumplimiento 28d (%)', k.cumplimiento28d ?? ''],
        ['Peor tipo', k.peorTipo ? `${k.peorTipo.tipo} (${k.peorTipo.cumplimiento}%)` : ''],
        ['Tipos bajo control', k.totalTipos > 0 ? `${k.tiposBajoControl}/${k.totalTipos}` : ''],
        ['Alertas pendientes', alertCount ?? 0],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenRows), 'KPIs');

    /* Hoja Alertas */
    if (alertasPendientes?.length > 0) {
        const rows = [
            ['Nivel', 'Material', 'Mensaje', 'Fecha'],
            ...alertasPendientes.map((a) => [
                a.nivel ?? '',
                a.nombreMaterial ?? '',
                a.mensaje ?? '',
                a.fecha ?? '',
            ]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Alertas');
    }

    /* Hoja Resumen por tipo */
    if (data?.summaryByTipo?.length > 0) {
        const rows = [
            ['Tipo H°', 'n', 'Media (MPa)', 'Desvío σ', 'CV (%)', "f'ck (MPa)", 'Mín', 'Máx', 'Cumplimiento (%)'],
            ...data.summaryByTipo.map((r) => [
                r.tipoHormigon ?? '',
                r.n ?? '',
                r.media ?? '',
                r.desvio ?? '',
                r.cv ?? '',
                r.fck ?? '',
                r.min ?? '',
                r.max ?? '',
                r.cumplimiento ?? '',
            ]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Por tipo');
    }

    /* Hoja Evolución */
    if (data?.evolution?.series?.length > 0) {
        const norm = data.evolution.normalizado;
        const rows = [
            ['Mes', `Media${norm ? ' (%)' : ' (MPa)'}`, norm ? '' : "f'ck", 'CV (%)', 'n'],
            ...data.evolution.series.map((e) => [e.label ?? '', e.media ?? '', norm ? '' : e.fck ?? '', e.cv ?? '', e.n ?? '']),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Evolución');
    }

    /* Hoja Actividad reciente */
    if (data?.recentActivity?.length > 0) {
        const rows = [
            ['Fecha ensayo', 'Probeta', 'Remito', 'Tipo H°', 'Edad', 'Resistencia (MPa)', 'Estado'],
            ...data.recentActivity.map((r) => [
                r.fechaEnsayo ?? '',
                r.probeta ?? '',
                r.remito ?? '',
                r.tipoHormigon ?? '',
                r.edadEnsayo ?? '',
                r.resistencia ?? '',
                r.pendiente ? 'Pendiente' : 'Revisado',
            ]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Actividad reciente');
    }

    XLSX.writeFile(wb, `Tablero_General_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`);
}

/* ═══════════════════════════════════════════════════════
   Vista PLANTA (operativa)
   ═══════════════════════════════════════════════════════ */

export async function exportPlantaPDF({ data, plantaLabel, configEmpresa = {} }) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 12;
    let y = pdfHeader(doc, {
        titulo: `Dashboard de Planta — ${plantaLabel || '—'}`,
        configEmpresa,
    });

    /* KPIs */
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Indicadores clave', margin, y);
    y += 2;
    doc.autoTable({
        startY: y + 2,
        head: [['Indicador', 'Valor']],
        body: [
            ['Agregados (total)', data?.materiales?.total ?? '—'],
            ['  · Finos', data?.materiales?.finos ?? '—'],
            ['  · Gruesos', data?.materiales?.gruesos ?? '—'],
            ['Cementos', data?.cementos ?? '—'],
            ['Mezclas aprobadas', data?.mezclas?.aprobadas ?? '—'],
            ['Dosificaciones', data?.dosificaciones?.total ?? '—'],
            ['Alertas pendientes', data?.alertas?.total ?? 0],
        ],
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [59, 130, 246] },
        margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 5;

    /* Dosificaciones por estado */
    if (data?.dosificaciones?.porEstado && Object.keys(data.dosificaciones.porEstado).length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Dosificaciones por estado', margin, y);
        y += 2;
        doc.autoTable({
            startY: y + 2,
            head: [['Estado', 'Cantidad']],
            body: Object.entries(data.dosificaciones.porEstado).map(([k, v]) => [ESTADO_LABEL[k] || k, v]),
            theme: 'striped',
            styles: { fontSize: 8, cellPadding: 1.5 },
            headStyles: { fillColor: [139, 92, 246] },
            margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 5;
    }

    /* Mezclas por estado */
    if (data?.mezclas?.porEstado && Object.keys(data.mezclas.porEstado).length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Mezclas por estado', margin, y);
        y += 2;
        doc.autoTable({
            startY: y + 2,
            head: [['Estado', 'Cantidad']],
            body: Object.entries(data.mezclas.porEstado).map(([k, v]) => [ESTADO_LABEL[k] || k, v]),
            theme: 'striped',
            styles: { fontSize: 8, cellPadding: 1.5 },
            headStyles: { fillColor: [16, 185, 129] },
            margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 5;
    }

    /* Alertas */
    if (data?.alertas?.items?.length > 0) {
        if (y + 30 > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Alertas pendientes', margin, y);
        y += 2;
        doc.autoTable({
            startY: y + 2,
            head: [['Nivel', 'Material', 'Mensaje']],
            body: data.alertas.items.map((a) => [
                String(a.nivel || '').toUpperCase(),
                a.nombreMaterial ?? '—',
                a.mensaje ?? '—',
            ]),
            theme: 'striped',
            styles: { fontSize: 7.5, cellPadding: 1.5 },
            headStyles: { fillColor: [245, 158, 11] },
            margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 5;
    }

    /* Dosificaciones recientes */
    if (data?.dosificaciones?.recientes?.length > 0) {
        if (y + 30 > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Dosificaciones recientes', margin, y);
        y += 2;
        doc.autoTable({
            startY: y + 2,
            head: [['Nombre', 'Estado', 'Versión', 'Fecha']],
            body: data.dosificaciones.recientes.map((r) => [
                r.nombre || `#${r.id}`,
                ESTADO_LABEL[r.estado] || r.estado || '—',
                r.version ?? '—',
                r.fecha ? new Date(r.fecha).toLocaleDateString('es-AR') : '—',
            ]),
            theme: 'striped',
            styles: { fontSize: 7.5, cellPadding: 1.5 },
            headStyles: { fillColor: [139, 92, 246] },
            margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 5;
    }

    /* Mezclas recientes */
    if (data?.mezclas?.recientes?.length > 0) {
        if (y + 30 > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Mezclas recientes', margin, y);
        y += 2;
        doc.autoTable({
            startY: y + 2,
            head: [['Nombre', 'Tipo', 'Estado', 'TMN', 'Fecha']],
            body: data.mezclas.recientes.map((r) => [
                r.nombre || `#${r.id}`,
                r.tipo ?? '—',
                ESTADO_LABEL[r.estado] || r.estado || '—',
                r.tmn ? `${r.tmn} mm` : '—',
                r.fecha ? new Date(r.fecha).toLocaleDateString('es-AR') : '—',
            ]),
            theme: 'striped',
            styles: { fontSize: 7.5, cellPadding: 1.5 },
            headStyles: { fillColor: [16, 185, 129] },
            margin: { left: margin, right: margin },
        });
    }

    pdfFooter(doc, 'HormiQual — Dashboard de Planta');
    const safePlanta = (plantaLabel || 'planta').replace(/[^a-z0-9-]+/gi, '_').slice(0, 20);
    doc.save(`Tablero_Planta_${safePlanta}_${dayjs().format('YYYYMMDD_HHmm')}.pdf`);
}

export function exportPlantaExcel({ data, plantaLabel }) {
    const wb = XLSX.utils.book_new();

    const resumenRows = [
        [`Dashboard de Planta — ${plantaLabel || '—'}`],
        ['Generado', dayjs().format('DD/MM/YYYY HH:mm')],
        [],
        ['Indicador', 'Valor'],
        ['Agregados (total)', data?.materiales?.total ?? ''],
        ['  · Finos', data?.materiales?.finos ?? ''],
        ['  · Gruesos', data?.materiales?.gruesos ?? ''],
        ['Cementos', data?.cementos ?? ''],
        ['Mezclas aprobadas', data?.mezclas?.aprobadas ?? ''],
        ['Dosificaciones', data?.dosificaciones?.total ?? ''],
        ['Alertas pendientes', data?.alertas?.total ?? 0],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenRows), 'KPIs');

    if (data?.dosificaciones?.porEstado) {
        const rows = [
            ['Estado', 'Cantidad'],
            ...Object.entries(data.dosificaciones.porEstado).map(([k, v]) => [ESTADO_LABEL[k] || k, v]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Dosif. por estado');
    }
    if (data?.mezclas?.porEstado) {
        const rows = [
            ['Estado', 'Cantidad'],
            ...Object.entries(data.mezclas.porEstado).map(([k, v]) => [ESTADO_LABEL[k] || k, v]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Mezclas por estado');
    }
    if (data?.alertas?.items?.length > 0) {
        const rows = [
            ['Nivel', 'Material', 'Mensaje'],
            ...data.alertas.items.map((a) => [
                String(a.nivel || '').toUpperCase(),
                a.nombreMaterial ?? '',
                a.mensaje ?? '',
            ]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Alertas');
    }
    if (data?.dosificaciones?.recientes?.length > 0) {
        const rows = [
            ['Nombre', 'Estado', 'Versión', 'Fecha'],
            ...data.dosificaciones.recientes.map((r) => [
                r.nombre || `#${r.id}`,
                ESTADO_LABEL[r.estado] || r.estado || '',
                r.version ?? '',
                r.fecha ?? '',
            ]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Dosif. recientes');
    }
    if (data?.mezclas?.recientes?.length > 0) {
        const rows = [
            ['Nombre', 'Tipo', 'Estado', 'TMN (mm)', 'Fecha'],
            ...data.mezclas.recientes.map((r) => [
                r.nombre || `#${r.id}`,
                r.tipo ?? '',
                ESTADO_LABEL[r.estado] || r.estado || '',
                r.tmn ?? '',
                r.fecha ?? '',
            ]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Mezclas recientes');
    }

    const safePlanta = (plantaLabel || 'planta').replace(/[^a-z0-9-]+/gi, '_').slice(0, 20);
    XLSX.writeFile(wb, `Tablero_Planta_${safePlanta}_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`);
}
