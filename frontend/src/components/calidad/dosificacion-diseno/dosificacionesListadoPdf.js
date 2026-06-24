/**
 * Listado del catálogo de dosificaciones — PDF entregable.
 *
 * Exporta a PDF la grilla "Catálogo de dosificaciones" (Calidad → Catálogos →
 * Dosificaciones) respetando los filtros aplicados en pantalla (planta, estado,
 * búsqueda). Mismas columnas visibles de la tabla, sin acciones ni selección.
 *
 * Stack HormiQual: jsPDF + jspdf-autotable client-side. Reutiliza el header
 * canónico (`drawPdfHeader` con banda azul) y la fuente DejaVu para que la capa
 * de texto conserve tildes/ñ.
 *
 * Modelo dual (DESCRIPTIVO/NORMATIVO): este es un listado de inventario de
 * recetas, NO emite veredicto de aptitud ni juicio normativo sobre cada
 * dosificación, por lo que es DESCRIPTIVO por naturaleza y no lleva toggle ni
 * banner de modo.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { sanitizePdfText, formatDate, formatDateFile } from '../../../lib/format';
import { drawPdfHeader } from '../../../lib/format/pdfHeader';
import { registerDejavuOnDoc } from '../../../lib/format/dejavuFont';

const tx = (s) => sanitizePdfText(s);

// Paleta alineada con los demás documentos técnicos (dosificacionInformePdf,
// fichaMuestraPdf): azul oscuro de header/banda + azul medio para el head de
// la tabla.
const C = {
  primary: [18, 52, 86],
  sectionTone: [56, 111, 194],
  white: [255, 255, 255],
};

// Espejo de los labels de la pantalla (DosificacionesCatalogoPage). Todos los
// métodos de cálculo se presentan al usuario como "HormiQual".
const METODO_LABELS = { HORMIQUAL: 'HormiQual', ICPA: 'HormiQual', ACI_211: 'HormiQual' };

const ESTADO_LABELS = {
  BORRADOR: 'Borrador',
  A_PRUEBA: 'A prueba',
  PENDIENTE_REVISION: 'Pendiente revisión',
  APROBADO: 'Aprobado',
  SUSPENDIDO: 'Suspendido',
  ARCHIVADO: 'Archivado',
  // Legacy
  VALIDADO: 'Aprobado',
  EN_PRODUCCION: 'Aprobado',
  OBSOLETO: 'Archivado',
};

/**
 * Genera y descarga el PDF del listado.
 *
 * @param {Array}  dosificaciones - filas ya filtradas (mismo array que la tabla).
 * @param {Object} opts
 * @param {Object} opts.configEmpresa - { nombreEmpresa, direccion, logoLink, ... }
 * @param {Object} opts.filtros - { planta, estado, busqueda } (labels legibles).
 */
export async function generarDosificacionesListadoPdf(dosificaciones = [], opts = {}) {
  const { configEmpresa = {}, filtros = {} } = opts;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  try { await registerDejavuOnDoc(doc); }
  catch (e) { console.warn('[dosificacionesListadoPdf] DejaVu no se pudo registrar:', e); }

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;

  // Encabezado con banda azul. Suprimimos el nombre de empresa del header
  // (`nombreEmpresa: ''`) porque lo mostramos en el bloque de título debajo.
  let y = await drawPdfHeader(doc, {
    configEmpresa: { ...configEmpresa, nombreEmpresa: '', direccion: undefined },
    margin,
    headerBg: C.primary,
  });

  /* ─── Título + empresa ─── */
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.primary);
  doc.text(tx('Catálogo de dosificaciones'), margin, y + 4);
  y += 7;
  if (configEmpresa.nombreEmpresa) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(tx(configEmpresa.nombreEmpresa), margin, y + 2);
    y += 5;
  }

  /* ─── Filtros aplicados ─── */
  const filtrosTxt = [
    `Planta: ${filtros.planta || 'Todas'}`,
    `Estado: ${filtros.estado || 'Todos'}`,
    filtros.busqueda ? `Búsqueda: "${filtros.busqueda}"` : null,
    `Total: ${dosificaciones.length}`,
  ].filter(Boolean).join('     ');
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(90, 90, 90);
  doc.text(tx(filtrosTxt), margin, y + 2);
  y += 6;

  /* ─── Tabla ─── */
  const head = [[
    '#', 'Nombre', 'Planta', 'Método', 'Estado', 'Versión', 'Cemento', 'Mezcla', 'Actualizado',
  ]];

  const body = dosificaciones.map((row, i) => [
    String(i + 1),
    tx(row.nombre || `Diseño #${row.id}`),
    tx(row.planta?.nombre || '—'),
    tx(METODO_LABELS[row.metodo] || row.metodo || '—'),
    tx(ESTADO_LABELS[row.estado] || row.estado || '—'),
    `v${row.version || 1}`,
    tx(row.cemento?.nombreComercial || '—'),
    tx(row.mezcla?.nombre || '—'),
    row.updatedAt ? formatDate(row.updatedAt) : '—',
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head,
    body,
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak' },
    headStyles: { fillColor: C.sectionTone, textColor: C.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [244, 247, 251] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 9 },
      1: { cellWidth: 52 },
      2: { cellWidth: 34 },
      3: { halign: 'center', cellWidth: 24 },
      5: { halign: 'center', cellWidth: 18 },
      8: { halign: 'center', cellWidth: 24 },
    },
    tableWidth: contentW,
  });

  /* ─── Footer paginación ─── */
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110, 110, 110);
    doc.text(`Página ${i}/${total}`, pageW - margin, pageH - 5, { align: 'right' });
    doc.text(tx('Catálogo de dosificaciones'), margin, pageH - 5);
  }

  const filename = `Catalogo_dosificaciones_${formatDateFile()}.pdf`;
  doc.save(filename);
}
